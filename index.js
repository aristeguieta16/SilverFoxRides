const express = require('express');
const { Client, Environment } = require('square');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const cors = require('cors');
const mongoose = require('mongoose');

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

const reservationStore = {};

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB:', err));

// Define allowed origins
const allowedOrigins = ['https://silverfoxrides.vip', 'https://silver-fox-rides.vercel.app'];

const reservationSchema = new mongoose.Schema({
  orderId: String,
  reservationDetails: Object,
});

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
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

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
// Enhanced error logging for create-checkout endpoint
app.post('/api/create-checkout', async (req, res) => {
  const { price, idempotencyKey, reservationDetails } = req.body;

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
            amount: Number(Math.round(price * 100)), // Convert to Number to avoid BigInt issue
            currency: "USD",
          },
        },
      ],
    };

    const checkoutBody = {
      idempotencyKey: idempotencyKey,
      order: order,
    };

    const checkoutResponse = await client.checkoutApi.createPaymentLink(checkoutBody);
    const checkoutUrl = checkoutResponse.result.paymentLink.url;
    const orderId = checkoutResponse.result.paymentLink.orderId;

    reservationStore[orderId] = reservationDetails;
    res.json({ checkoutUrl: checkoutUrl });

  } catch (error) {
    console.error('Square API Error:', error.message);
    
    if (error.response && error.response.data) {
      console.error('Square API Response Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Full Error Object:', error);
    }

    res.status(500).json({ error: 'Error creating checkout. Please try again later.' });
  }
});

const Reservation = mongoose.model('Reservation', reservationSchema);

// Payment confirmation endpoint
app.post('/payment-confirmation', async (req, res) => {
  const event = req.body;
  console.log('Received event:', JSON.stringify(event, null, 2));

  const eventType = event.type || event.event_type;
  console.log('Event type:', eventType);

  if (eventType === 'payment.created') {
    const paymentDetails = event.data.object.payment;
    const orderId = paymentDetails.order_id;

    // Retrieve the reservation details from MongoDB
    const reservation = await Reservation.findOne({ orderId });
    if (!reservation) {
      console.error("No reservation details found for this payment.");
      res.status(400).json({ message: "Reservation details not found." });
      return;
    }

    // Log reservation details for debugging
    console.log('Reservation Details:', reservation.reservationDetails);

    // Send email notification
    sendEmailNotification(reservation.reservationDetails);
    res.status(200).json({ message: 'Payment confirmation received' });

    // Optionally, delete the reservation after processing
    await Reservation.deleteOne({ orderId });
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