const { Client, Environment } = require('square');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const { createEvent } = require('ics');
const axios = require('axios');
const { writeFileSync } = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Serve static files from the 'public' directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

app.use(bodyParser.json());

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

// Middleware to capture raw body data for signature validation
app.use((req, res, next) => {
  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk.toString();
  });
  req.on('end', () => {
    req.rawBody = rawBody;
    console.log('Raw Body:', rawBody); // Log the raw body for debugging
    next();
  });
});

// Force NODE_ENV to development for local testing
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

function validateSquareSignature(req) {
  console.log('Request Body:', req.rawBody); // Log the raw body for debugging
  console.log('Headers:', JSON.stringify(req.headers, null, 2)); // Log the headers for debugging

  if (process.env.NODE_ENV === 'development') {
    console.log('Bypassing signature validation in development mode');
    return true;
  }

  try {
    const signature = req.headers['x-square-signature'];
    const body = req.rawBody; // Use the raw body captured by middleware
    const expectedSignature = crypto
      .createHmac('sha256', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
      .update(body, 'utf8')
      .digest('base64');

    console.log('Calculated signature:', expectedSignature);
    return signature === expectedSignature;
  } catch (error) {
    console.error('Error during signature validation:', error.message);
    return false;
  }
}

// Serve the main HTML file for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
      note: `Pickup Location: ${reservationDetails.pickupLocation}, Dropoff Location: ${reservationDetails.dropoffLocation}, Pickup Date: ${reservationDetails.pickupDate}, Pickup Time: ${reservationDetails.pickupTime}, First Name: ${reservationDetails.customerFirstName}, Last Name: ${reservationDetails.customerLastName}, Phone: ${reservationDetails.customerPhoneNumber}`,
    };

    const body = {
      idempotencyKey: idempotencyKey,
      order: order,
    };

    const checkoutResponse = await client.checkoutApi.createPaymentLink(body);
    const checkoutUrl = checkoutResponse.result.paymentLink.url;

    res.json({ checkoutUrl });
  } catch (error) {
    console.error('Square API Error:', error);
    res.status(500).json({ error: 'Error creating checkout. Please try again later.' });
  }
});

app.post('/api/payment-confirmation', async (req, res) => {
  console.log('Received payment confirmation request:', new Date().toISOString());

  try {
    const start = Date.now();
    const event = req.body;

    // Validate signature
    if (!validateSquareSignature(req)) {
      console.error('Invalid signature');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    console.log('Signature validation passed:', Date.now() - start, 'ms');

    // Process event
    if (event.event_type === 'payment.created') {
      console.log('Processing payment created event:', new Date().toISOString());

      const paymentDetails = event.data?.object?.payment;
      if (!paymentDetails) {
        console.error('Invalid payment data received:', JSON.stringify(event));
        return res.status(400).json({ message: 'Invalid payment data received.' });
      }

      // Continue processing...
      console.log('Successfully processed event in:', Date.now() - start, 'ms');
      return res.status(200).json({ message: 'Payment confirmation received and logged.' });
    }

    console.error('Invalid event type:', event.event_type);
    res.status(400).json({ message: 'Invalid event type' });
  } catch (error) {
    console.error('Error processing payment confirmation:', error.stack || error.message);
    res.status(500).json({ message: 'Internal server error during processing.' });
  }
});

function extractField(note, fieldName) {
  const regex = new RegExp(`${fieldName}: ([^,]+)`);
  const match = note.match(regex);
  return match ? match[1] : 'Not provided';
}

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
    subject: 'New Reservation Notification',
    text: `Reservation Details:
  Pickup Location: ${reservationDetails.pickupLocation}
  Dropoff Location: ${reservationDetails.dropoffLocation}
  Pickup Date: ${reservationDetails.pickupDate}
  Pickup Time: ${reservationDetails.pickupTime}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

function sendCalendarInvite(reservationDetails) {
  const [year, month, day] = reservationDetails.pickupDate.split('-').map(Number);
  const [hours, minutes] = reservationDetails.pickupTime.split(':').map(Number);

  const event = {
    start: [year, month, day, hours, minutes],
    duration: { hours: 1 },
    title: 'Ride Reservation',
    description: 'Your booked ride reservation.',
    location: reservationDetails.pickupLocation,
    status: 'CONFIRMED',
    organizer: { name: 'SilverFox', email: process.env.EMAIL_USER },
    attendees: [{ name: 'Customer', email: reservationDetails.customerEmail }],
  };

  createEvent(event, (error, value) => {
    if (error) {
      console.log('Error generating calendar event:', error);
      return;
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.NOTIFICATION_EMAIL,
      subject: 'New Reservation with Calendar Event',
      text: `Reservation Details:
  Pickup Location: ${reservationDetails.pickupLocation}
  Dropoff Location: ${reservationDetails.dropoffLocation}
  Pickup Date: ${reservationDetails.pickupDate}
  Pickup Time: ${reservationDetails.pickupTime}`,
      icalEvent: {
        filename: 'reservation.ics',
        method: 'request',
        content: value,
      },
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('Error sending email:', error);
      } else {
        console.log('Email sent with calendar event:', info.response);
      }
    });
  });
}

function sendSMSNotification(reservationDetails) {
  const message = `New Reservation:
  Pickup: ${reservationDetails.pickupLocation}
  Dropoff: ${reservationDetails.dropoffLocation}
  Date: ${reservationDetails.pickupDate}
  Time: ${reservationDetails.pickupTime}`;

  const options = {
    method: 'POST',
    url: 'https://nest.messagebird.com/workspaces/your-workspace-id/channels/your-channel-id/messages', // Replace with Bird’s actual API endpoint for sending SMS
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `AccessKey ${process.env.SMS_API_KEY}`
    },
    data: {
      "receiver": {
        "contacts": [
          { "identifierValue": process.env.NOTIFICATION_PHONE }
        ]
      },
      "body": {
        "type": "sms",
        "sms": {
          "text": message
        }
      }
    }
  };

  axios(options)
    .then(response => {
      console.log('SMS sent successfully:', response.data);
    })
    .catch(error => {
      console.error('Error sending SMS:', error.response ? error.response.data : error.message);
    });
}

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Set timeout to avoid gateway timeouts
server.setTimeout(5000); // 5 seconds timeout

module.exports = app;