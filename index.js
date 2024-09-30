const express = require('express');
const Stripe = require('stripe'); 
const bodyParser = require('body-parser'); 
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const cors = require('cors');
const { Vonage } = require('@vonage/server-sdk');
const brevo = require('@getbrevo/brevo');

// Initialize Express
const app = express();
app.use(bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf
    }
}))
const port = process.env.PORT || 3000;

const reservationStore = {};

// Initialize Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const corsOptions = {
  origin: ['https://www.silverfoxrides.com', 'https://silverfoxrides.com'],
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization, X-Requested-With',
  credentials: true
};

app.use((req, res, next) => {
  if (req.headers.host === 'silverfoxrides.com' && !req.url.startsWith('https://www.silverfoxrides.com')) {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.silverfoxrides.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.redirect(301, `https://www.silverfoxrides.com${req.url}`);
  } else {
    cors(corsOptions)(req, res, next);
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse JSON
app.use(express.json());

// Route for the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Route for the thank you page
app.get('/thank-you.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

// Stripe payment creation endpoint
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
                  unit_amount: Math.round(price * 100), // Stripe expects the amount in cents
              },
              quantity: 1,
          }],
          mode: 'payment',
          success_url: 'https://www.silverfoxrides.com/thank-you.html',
          cancel_url: 'https://www.silverfoxrides.com/book.html',
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
app.post('/api/payment-confirmation', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    console.log('Received Stripe Signature:', sig); // Log the signature for debugging
    console.log("Req",req,  req.rawBody)
    let res1 = '';
    let res2 = '';
    try {
        const event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log('Constructed Event:', event); // Log the event details for debugging
        
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            let {amount_total, payment_intent, payment_status} = session
            const reservationDetails = JSON.parse(session.metadata.reservationDetails);

            // Send notifications here (email/SMS)
            console.log('Payment successful!', reservationDetails);
            res1 = await sendEmailNotification({...reservationDetails, amount_total, payment_intent, payment_status });
            res2 = await sendSMSNotification(reservationDetails);
        }

        res.status(200).send({ received: true, res1, res2 });
    } catch (error) {
        console.error(`Webhook Error: ${error.message}`);
        res.status(400).send(`Webhook Error: ${error.message}`);
    }
});

// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: "smtp.gmail.com",
    port: 465, 
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        rejectUnauthorized: false,
    },
});

// Function to send email notifications
async function sendEmailNotification(reservationDetails) {
    //     const mailOptions = {
    //         from: process.env.EMAIL_USER,
    //         to: process.env.NOTIFICATION_EMAIL,
    //         subject: 'New SilverFox Reservation!!',
    //         text: `Reservation Details:
    // First Name: ${reservationDetails.customerFirstName}
    // Last Name: ${reservationDetails.customerLastName}
    // Phone Number: ${reservationDetails.customerPhoneNumber}
    // Pickup Location: ${reservationDetails.pickupLocation}
    // Dropoff Location: ${reservationDetails.dropoffLocation}
    // Pickup Date: ${reservationDetails.pickupDate}
    // Pickup Time: ${reservationDetails.pickupTime}
    // Customer Email: ${reservationDetails.customerEmail}`,
    //     };

    //     transporter.sendMail(mailOptions, (error, info) => {
    //         if (error) {
    //             console.error('Error sending email:', error); // Log detailed error
    //         } else {
    //             console.log('Email sent:', info.response); // Log the success response
    //         }
    //     });
    // let defaultClient = brevo.ApiClient.instance;

    // let apiKey = defaultClient.authentications['apiKey'];
    // apiKey.apiKey = process.env.BREVO_API_KEY;

    let apiInstance = new brevo.TransactionalEmailsApi();
    let apiKey = apiInstance.authentications['apiKey'];
    apiKey.apiKey = process.env.BREVO_API_KEY;
    let sendSmtpEmail = new brevo.SendSmtpEmail();

    sendSmtpEmail.subject = "New SilverFox Reservation!!";
    sendSmtpEmail.htmlContent = `Reservation Details:<br/>
    First Name: ${reservationDetails.customerFirstName}<br/>
    Last Name: ${reservationDetails.customerLastName}<br/>
    Phone Number: ${reservationDetails.customerPhoneNumber}<br/>
    Pickup Location: ${reservationDetails.pickupLocation}<br/>
    Dropoff Location: ${reservationDetails.dropoffLocation}<br/>
    ${!!reservationDetails.dropoffLocation2 ? 'Next dropoff location for round trip: '+ reservationDetails.dropoffLocation2 + '<br/>' : ''}
    Pickup Date: ${reservationDetails.pickupDate}<br/>
    Pickup Time: ${reservationDetails.pickupTime}<br/>
    Customer Email: ${reservationDetails.customerEmail}<br/>
    Number of passengers: ${reservationDetails.numPassengers}<br/>
    Ride choice: ${reservationDetails.rideChoice}<br/>
    ${!!reservationDetails.flightNumber ? 'Flight Number: '+ reservationDetails.flightNumber + '<br/>' : ''}
    Amount total: ${(reservationDetails.amount_total / 100)}<br/>
    Stripe payment intent id: ${reservationDetails.payment_intent}<br/>
    Stripe payment status: ${reservationDetails.payment_status}<br/>`;
    sendSmtpEmail.sender = { "name": "Josepabon", "email": process.env.EMAIL_USER };
    sendSmtpEmail.to = [
    { "email": process.env.NOTIFICATION_EMAIL, "name": reservationDetails.customerFirstName }
    ];

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail)
    console.log('API called successfully. Returned data: ' + JSON.stringify(data));
    return data;
}

// Initialize Vonage client
const vonage = new Vonage({
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
});

// Function to send SMS notifications
function sendSMSNotification(reservationDetails) {
    const from = process.env.VONAGE_PHONE_NUMBER;
    const to = process.env.NOTIFICATION_PHONE;
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
app.listen(port, () => console.log(`Server running on port ${port}`)).on('error', (err) => {
  console.error('Error starting server:', err);
});