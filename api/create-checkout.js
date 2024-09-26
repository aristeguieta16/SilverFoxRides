const { Client, Environment } = require('square');

const client = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: Environment.Production,
});

const reservationStore = {}; // Adjust this to a database for production environments

export default async (req, res) => {
    if (req.method === 'POST') {
        const { price, idempotencyKey, reservationDetails } = req.body;

        console.log('Received request to create checkout:', {
            price,
            idempotencyKey,
            reservationDetails,
        });

        if (!price || !idempotencyKey || !reservationDetails) {
            console.error('Missing required fields:', { price, idempotencyKey, reservationDetails });
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
                            amount: Number(Math.round(price * 100)), // Convert to cents
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

            if (orderId && reservationDetails) {
                reservationStore[orderId] = reservationDetails;
                console.log('Stored reservation details:', { orderId, reservationDetails });
            } else {
                console.error('Failed to store reservation details due to missing orderId or reservation details.');
            }

            res.json({ checkoutUrl: checkoutUrl });

        } catch (error) {
            console.error('Square API Error:', error.message);
            res.status(500).json({ error: 'Error creating checkout. Please try again later.' });
        }
    } else {
        res.status(405).json({ message: 'Method not allowed' });
    }
};
