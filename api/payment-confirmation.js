const nodemailer = require('nodemailer');
const { Vonage } = require('@vonage/server-sdk');

const reservationStore = {}; // Adjust this to a database for production environments

const vonage = new Vonage({
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
});

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

export default (req, res) => {
    if (req.method === 'POST') {
        const event = req.body;
        const eventType = event.type || event.event_type;

        if (eventType === 'payment.created') {
            const paymentDetails = event.data.object.payment;
            const orderId = paymentDetails.order_id;

            if (!orderId || !reservationStore[orderId]) {
                console.error(`No reservation details found for this payment with orderId: ${orderId}`);
                res.status(400).json({ message: "Reservation details not found." });
                return;
            }

            const reservationDetails = reservationStore[orderId];

            sendEmailNotification(reservationDetails);
            sendSMSNotification(reservationDetails);

            delete reservationStore[orderId];

            res.status(200).json({ message: 'Payment confirmation received' });
        } else {
            res.status(400).json({ message: 'Invalid event type' });
        }
    } else {
        res.status(405).json({ message: 'Only POST requests are allowed.' });
    }
};