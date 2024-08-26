const { Client, Environment } = require('square');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

app.use(bodyParser.json());

const reservationStore = {};

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

app.get('/thank-you.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

app.post('/create-checkout', async (req, res) => {
    const { price, idempotencyKey, reservationDetails } = req.body;
  
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
  
      const checkoutResponse = await client.checkoutApi.createPaymentLink(checkoutBody);
      const checkoutUrl = checkoutResponse.result.paymentLink.url;
  
      // Store reservation details using the order_id
      const orderId = checkoutResponse.result.paymentLink.orderId; // Get the order_id from the response
      reservationStore[orderId] = reservationDetails;
  
      // Log the stored reservation details
      console.log('Storing reservation details with orderId:', orderId);
  
      // Send the checkout URL to the client
      res.json({ checkoutUrl: checkoutUrl });
    } catch (error) {
      console.error('Square API Error:', error);
      res.status(500).json({ error: 'Error creating checkout.' });
    }
  });    

  app.post('/payment-confirmation', (req, res) => {
    const event = req.body;
  
    if (event.type === 'payment.created') {
      const paymentDetails = event.data.object.payment;
      const orderId = paymentDetails.order_id;
  
      if (reservationStore[orderId]) {
        const reservationDetails = reservationStore[orderId];
  
        // Log reservation details for debugging
        console.log('Reservation Details:', reservationDetails);
  
        // Send email notification
        sendEmailNotification(reservationDetails);
  
        // Clean up reservationStore to prevent memory leaks
        delete reservationStore[orderId];
  
        res.status(200).json({ message: 'Payment confirmation received' });
      } else {
        // Prevent processing the same event twice or an event with missing data
        console.warn(`No reservation details found for orderId: ${orderId}`);
        res.status(200).json({ message: 'Duplicate or missing data. Event ignored.' });
      }
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