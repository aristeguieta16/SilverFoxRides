const express = require('express');
const Stripe = require('stripe');  // Import Stripe
const bodyParser = require('body-parser');  // Import bodyParser
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const cors = require('cors');
const { Vonage } = require('@vonage/server-sdk');

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

// Initialize Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);  // Your Stripe secret key

const reservationStore = {};

const allowedOrigins = ['https://silverfoxrides.vip', 'https://silver-fox-rides.vercel.app'];

app.use(cors({
  origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
      } else {
          console.error(`CORS error: Origin ${origin} not allowed`);
          callback(new Error('Not allowed by CORS'));
      }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'], // Ensure this line is present
  credentials: true,
}));

// Explicitly handle OPTIONS method for all routes to handle preflight requests
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin); // Echo the origin
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Add headers here
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Middleware to set CORS headers for each request
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
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

// Stripe payment creation endpoint
app.post('/api/create-checkout', async (req, res) => {
    const { price, reservationDetails } = req.body;

    try {
        // Create a Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Ride Booking',
                    },
                    unit_amount: Math.round(price * 100),  // Stripe expects the amount in cents
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: 'https://silverfoxrides.vip/thank-you.html',
            cancel_url: 'https://silverfoxrides.vip/cancel.html',
            metadata: {
                reservationDetails: JSON.stringify(reservationDetails),
            },
        });

        // Store the reservation details
        reservationStore[session.id] = reservationDetails;

        res.json({ checkoutUrl: session.url });
    } catch (error) {
        console.error('Error creating Stripe checkout session:', error.message);
        res.status(500).json({ error: 'Error creating checkout. Please try again later.' });
    }
});

// Stripe webhook to handle payment confirmations
app.post('/api/payment-confirmation', bodyParser.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    console.log('Received Stripe Signature:', sig);  // Log the signature for debugging

    try {
        const event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log('Constructed Event:', event);  // Log the event details for debugging
        
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const reservationDetails = JSON.parse(session.metadata.reservationDetails);

            // Send notifications here (email/SMS)
            console.log('Payment successful!', reservationDetails);
            sendEmailNotification(reservationDetails);
            sendSMSNotification(reservationDetails);
        }

        res.json({ received: true });
    } catch (error) {
        console.error(`Webhook Error: ${error.message}`);
        res.status(400).send(`Webhook Error: ${error.message}`);
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
          console.error('Error sending email:', error); // Log detailed error
      } else {
          console.log('Email sent:', info.response); // Log the success response
      }
  });
}

// Initialize Vonage client
const vonage = new Vonage({
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
});

// Function to send SMS notifications
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

// Start the server
app.listen(port, () => console.log(`Server running on port ${port}`));