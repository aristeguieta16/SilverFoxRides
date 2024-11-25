const { Client, Environment } = require('square');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const { createEvent } = require('ics');
const axios = require('axios');
const { writeFileSync } = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

app.use(bodyParser.json());

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
  console.log("reservationDetails", reservationDetails);

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
      note: `Pickup Location: ${reservationDetails.pickupLocation}, Dropoff Location: ${reservationDetails.dropoffLocation}, Pickup Date: ${reservationDetails.pickupDate}, Pickup Time: ${reservationDetails.pickupTime}, First Name: ${reservationDetails.customerFirstName}, Last Name: ${reservationDetails.customerLastName}, Phone: ${reservationDetails.customerPhoneNumber}, Hours: ${reservationDetails.serviceHours}`,
    };

    const body = {
      idempotencyKey: idempotencyKey,
      order: order,
    };

    const checkoutResponse = await client.checkoutApi.createPaymentLink(body);
    console.log("checkoutResponse", checkoutResponse);
    const checkoutUrl = checkoutResponse.result.paymentLink.url;

    // Send the checkout URL to the client
    res.json({ checkoutUrl });
  } catch (error) {
    console.error('Square API Error:', error);
    res.status(500).json({ error: 'Error creating checkout. Please try again later.' });
  }
});

app.post('/payment-confirmation', (req, res) => {
  const event = req.body;

  if (event.type === 'payment.created') {
    const paymentDetails = event.data.object.payment;

    // Parse the note to extract reservation details
    const note = paymentDetails.note || '';
    console.log("note", note);
    const reservationDetails = {
      pickupLocation: extractField(note, 'Pickup Location'),
      dropoffLocation: extractField(note, 'Dropoff Location'),
      pickupDate: extractField(note, 'Pickup Date'),
      pickupTime: extractField(note, 'Pickup Time'),
      customerFirstName: extractField(note, 'First Name'),
      customerLastName: extractField(note, 'Last Name'),
      customerPhoneNumber: extractField(note, 'Phone'),
      customerEmail: paymentDetails.buyer_email_address, // This is captured directly from the payment details
    };

    // Send email notification with calendar invite
    sendEmailNotification(reservationDetails);
    res.status(200).json({ message: 'Payment confirmation received' });
  } else {
    res.status(400).json({ message: 'Invalid event type' });
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

// Function to send email notification with calendar invite
function sendEmailNotification(reservationDetails) {
  const [year, month, day] = reservationDetails.pickupDate.split('-').map(Number);
  const [hours, minutes] = reservationDetails.pickupTime.split(':').map(Number);

  const event = {
    start: [year, month, day, hours, minutes],
    duration: { hours: 1 },
    title: `Ride Reservation for ${reservationDetails.customerFirstName} ${reservationDetails.customerLastName}`,
    description: `Your ride from ${reservationDetails.pickupLocation} to ${reservationDetails.dropoffLocation}.`,
    location: `${reservationDetails.pickupLocation} to ${reservationDetails.dropoffLocation}`,
    status: 'CONFIRMED',
    organizer: { name: 'SilverFox', email: process.env.EMAIL_USER },
    attendees: [{ name: reservationDetails.customerFirstName, email: reservationDetails.customerEmail }],
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
  First Name: ${reservationDetails.customerFirstName}
  Last Name: ${reservationDetails.customerLastName}
  Phone Number: ${reservationDetails.customerPhoneNumber}
  Pickup Location: ${reservationDetails.pickupLocation}
  Dropoff Location: ${reservationDetails.dropoffLocation}
  Pickup Date: ${reservationDetails.pickupDate}
  Pickup Time: ${reservationDetails.pickupTime}

  Click the attached file to add this reservation to your calendar.`,
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

  // Function to send SMS using Bird API (optional)
  function sendSMSNotification(reservationDetails) {
    const message = `New Reservation:
  Pickup: ${reservationDetails.pickupLocation}
  Dropoff: ${reservationDetails.dropoffLocation}
  Date: ${reservationDetails.pickupDate}
  Time: ${reservationDetails.pickupTime}
  Service Hours: ${reservationDetails.serviceHours}`;

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

// Start the server
app.listen(port, () => console.log(`Server running on port ${port}`));