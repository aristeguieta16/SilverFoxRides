const express = require('express');
const { Client, Environment } = require('square');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const cors = require('cors');

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

// Define allowed origins
const allowedOrigins = ['https://silverfoxrides.vip'];

// Set up CORS middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl requests, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Allows sending cookies and headers like Authorization
}));

// Middleware to parse JSON
app.use(express.json());
app.use(bodyParser.json());

// Initialize Square client
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

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

// Create checkout endpoint
// Modify your checkout endpoint to include more detailed logs
app.post('/api/create-checkout', async (req, res) => {
  const { price, idempotencyKey, reservationDetails } = req.body;

  // Log the received request data
  console.log('Received request to create checkout with:', JSON.stringify(req.body, null, 2));

  if (!price || !idempotencyKey || !reservationDetails) {
    console.error('Validation Error: Missing required fields');
    return res.status(400).json({ error: 'Missing required fields: price, idempotencyKey, or reservationDetails' });
  }

  try {
    const order = {
      locationId: process.env.SQUARE_LOCATION_ID,
      lineItems: [
        {
          name: "Ride Booking",
          quantity: "1",
          basePriceMoney: {
            amount: Math.round(price * 100), // Amount in cents
            currency: "USD",
          },
        },
      ],
    };

    const checkoutBody = {
      idempotencyKey: idempotencyKey,
      order: order,
    };

    console.log('Creating Square checkout with body:', JSON.stringify(checkoutBody, null, 2));

    // Make the API call to create the payment link
    const checkoutResponse = await client.checkoutApi.createPaymentLink(checkoutBody);

    // Log the response from Square
    console.log('Square API Response:', JSON.stringify(checkoutResponse.result, null, 2));

    const checkoutUrl = checkoutResponse.result.paymentLink.url;
    const orderId = checkoutResponse.result.paymentLink.orderId;

    reservationStore[orderId] = reservationDetails;
    console.log('Stored reservation details:', JSON.stringify(reservationStore, null, 2));

    res.json({ checkoutUrl: checkoutUrl });
  } catch (error) {
    // Enhanced error logging
    console.error('Square API Error:', error.message);
    
    // Log detailed Square error response if available
    if (error.response && error.response.data) {
      console.error('Square API Error Details:', JSON.stringify(error.response.data, null, 2));
    }

    res.status(500).json({ error: 'Error creating checkout.' });
  }
});

// Payment confirmation endpoint
app.post('/payment-confirmation', (req, res) => {
  const event = req.body;
  console.log('Received event:', JSON.stringify(event, null, 2)); // Log full event for debugging

  const eventType = event.type || event.event_type; 
  console.log('Event type:', eventType); // Log event type for confirmation

  if (eventType === 'payment.created') {
    const paymentDetails = event.data.object.payment;

    const orderId = paymentDetails.order_id;
    const reservationDetails = reservationStore[orderId] || {};
    if (Object.keys(reservationDetails).length === 0) {
        console.error("No reservation details found for this payment.");
        res.status(400).json({ message: "Reservation details not found." });
        return;
    }

    // Log reservation details for debugging
    console.log('Reservation Details:', reservationDetails);

    // Send email notification
    sendEmailNotification(reservationDetails);
    res.status(200).json({ message: 'Payment confirmation received' });

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