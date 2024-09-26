const express = require('express');
const { Client, Environment } = require('square');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const cors = require('cors');
const { Vonage } = require('@vonage/server-sdk');

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

const reservationStore = {};

// Define allowed origins
const allowedOrigins = ['https://silverfoxrides.vip', 'https://silver-fox-rides.vercel.app'];

app.use(cors({
    origin: (origin, callback) => {
      console.log(`Incoming request from origin: ${origin}`);
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`CORS error: Origin ${origin} not allowed`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));  

// Explicitly handle OPTIONS method for all routes to handle preflight requests
app.options('*', (req, res) => {
  res.sendStatus(200); // Respond with 200 to OPTIONS preflight requests
});

// Middleware to parse JSON
app.use(express.json());
app.use(bodyParser.json());

// Middleware to log and ensure CORS headers are set correctly
app.use((req, res, next) => {
    console.log('Verifying CORS headers are set correctly');
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
  });  

// Initialize Square client
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

// Initialize Vonage client
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
});

function sendSMSNotification(reservationDetails) {
  const from = process.env.VONAGE_PHONE_NUMBER;  // Your Vonage phone number
  const to = process.env.NOTIFICATION_PHONE;  // The number you want to send the SMS to
  const text = `New Reservation: ${reservationDetails.customerFirstName} ${reservationDetails.customerLastName} - Pickup: ${reservationDetails.pickupLocation} at ${reservationDetails.pickupDate} ${reservationDetails.pickupTime}`;

  vonage.sms.send({ to, from, text }, (err, responseData) => {
    if (err) {
      console.error('Error sending SMS:', err);
    } else {
      if (responseData.messages[0].status === "0") {
        console.log('SMS sent successfully:', responseData);
      } else {
        console.error('Failed to send SMS:', responseData.messages[0]['error-text']);
      }
    }
  });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Route for the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Route for the thank you page
app.get('/thank-you.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

app.post('/api/create-checkout', async (req, res) => {
  const { price, idempotencyKey, reservationDetails } = req.body;

  // Log incoming request data for debugging
  console.log('Received request to create checkout:', {
    price,
    idempotencyKey,
    reservationDetails,
  });

  // Validate required fields
  if (!price || !idempotencyKey || !reservationDetails) {
    console.error('Missing required fields:', { price, idempotencyKey, reservationDetails });
    return res.status(400).json({ error: 'Missing required fields: price, idempotencyKey, or reservationDetails' });
  }

  try {
    // Define the order with location and line item details
    const order = {
      locationId: process.env.SQUARE_LOCATION_ID,
      lineItems: [
        {
          name: "Ride Booking",
          quantity: "1",
          basePriceMoney: {
            amount: Number(Math.round(price * 100)), // Convert to cents
            currency: "USD",
          },
        },
      ],
    };

    // Build the checkout body with idempotency key and order
    const checkoutBody = {
      idempotencyKey: idempotencyKey,
      order: order,
    };

    // Call Square API to create a payment link
    const checkoutResponse = await client.checkoutApi.createPaymentLink(checkoutBody);
    const checkoutUrl = checkoutResponse.result.paymentLink.url;
    const orderId = checkoutResponse.result.paymentLink.orderId;

    // Verify orderId and reservationDetails are correct before storing
    if (orderId && reservationDetails) {
      reservationStore[orderId] = reservationDetails;
      console.log('Stored reservation details:', { orderId, reservationDetails });
    } else {
      console.error('Failed to store reservation details due to missing orderId or reservation details.');
    }

    // Respond with the checkout URL to the client
    res.json({ checkoutUrl: checkoutUrl });

  } catch (error) {
    // Log detailed error information for debugging
    console.error('Square API Error:', error.message);
    if (error.response && error.response.data) {
      console.error('Square API Response Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Full Error Object:', error);
    }

    // Respond with an error status if checkout creation fails
    res.status(500).json({ error: 'Error creating checkout. Please try again later.' });
  }
});

app.post('/api/payment-confirmation', (req, res) => {
  const event = req.body;
  console.log('Received event:', JSON.stringify(event, null, 2)); // Log full event for debugging

  const eventType = event.type || event.event_type; 
  console.log('Event type:', eventType); // Log event type for confirmation

  if (eventType === 'payment.created') {
    const paymentDetails = event.data.object.payment;
    const orderId = paymentDetails.order_id;

    console.log('Received orderId:', orderId);
    console.log('Current reservation store:', reservationStore);

    // Check if orderId exists in reservationStore
    if (!orderId || !reservationStore[orderId]) {
      console.error(`No reservation details found for this payment with orderId: ${orderId}`);
      res.status(400).json({ message: "Reservation details not found." });
      return;
    }

    const reservationDetails = reservationStore[orderId];
    console.log('Found reservation details:', reservationDetails);

    // Send email notification
    sendEmailNotification(reservationDetails);
    res.status(200).json({ message: 'Payment confirmation received' });

    // Send SMS notification
    sendSMSNotification(reservationDetails);

    // Clean up reservationStore to prevent memory leaks
    delete reservationStore[orderId];
  } else {
    res.status(400).json({ message: 'Invalid event type' });
  }
});

// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Function to send email notifications
function sendEmailNotification(reservationDetails) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.NOTIFICATION_EMAIL,
    subject: 'New SilverFox Reservation!!',
    text: `Reservation Details:
First Name: ${reservationDetails.customerFirstName}
Last Name: ${reservationDetails.customerLastName}
Phone Number: ${reservationDetails.customerPhoneNumber}
Pickup Location: ${reservationDetails.pickupLocation}
Dropoff Location: ${reservationDetails.dropoffLocation}
Pickup Date: ${reservationDetails.pickupDate}
Pickup Time: ${reservationDetails.pickupTime}
Customer Email: ${reservationDetails.customerEmail}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

// Start the server
app.listen(port, () => console.log(`Server running on port ${port}`));
