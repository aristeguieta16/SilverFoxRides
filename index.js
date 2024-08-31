const { Client, Environment } = require('square');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const cors = require('cors');
app.use(express.json());

app.use(cors());

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

// Initialize Square client
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

app.use(bodyParser.json());

// In-memory storage for reservation details
const reservationStore = {};

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Allow cookies and authentication headers
}));

// Route for the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Route for the thank you page
app.get('/thank-you.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

// Create checkout endpoint
app.post('/api/create-checkout', async (req, res) => {
  const { price, idempotencyKey, reservationDetails } = req.body;

  // Basic validation for the required fields
  if (!price || !idempotencyKey || !reservationDetails) {
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

    // Make the API call to create the payment link
    const checkoutResponse = await client.checkoutApi.createPaymentLink(checkoutBody);

    // Extract the checkout URL and order ID
    const checkoutUrl = checkoutResponse.result.paymentLink.url;
    const orderId = checkoutResponse.result.paymentLink.orderId;

    // Store reservation details using the order ID
    reservationStore[orderId] = reservationDetails;
    console.log('Stored reservation details:', reservationStore);

    // Send the checkout URL back to the client
    res.json({ checkoutUrl: checkoutUrl });
  } catch (error) {
    // Enhanced error logging
    console.error('Square API Error:', error);
    
    // Check if the error has a response from Square and log the details
    if (error.response) {
      console.error('Square API response:', error.response.data);
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