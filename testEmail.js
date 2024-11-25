const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});
/* new */
const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.NOTIFICATION_EMAIL,
    subject: 'Test Email',
    text: 'This is a test email from your Node.js server.',
};

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.error('Error sending test email:', error);
    } else {
        console.log('Test email sent:', info.response);
    }
});
