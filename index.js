const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000', 
        // 'https://your-live-project.web.app' // প্রোডাকশন ইউআরএল বসবে
    ],
    credentials: true
}));
app.use(express.json());

// Auth Verification Middleware
const verifyToken = (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    
    const token = req.headers.authorization.split(' ')[1];
    
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }
        req.decoded = decoded;
        next();
    });
};

// Admin Verification Middleware (রোল বেসড অথরাইজেশন)
const verifyAdmin = async (req, res, next) => {
    const email = req.decoded.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    const isAdmin = user?.role === 'admin';
    if (!isAdmin) {
        return res.status(403).send({ message: 'Forbidden access' });
    }
    next();
};

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    // await client.connect(); // Vercel-এ ডেপ্লয়মেন্টের সময় এটি কমেন্ট করে রাখা ভালো

    // Database Collections
    const db = client.db('resellHubDB');
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');
    const reviewsCollection = db.collection('reviews');

    console.log("Successfully connected to MongoDB!");

    // ==========================================
    //  সব API Endpoint (JWT, Users, Products) এখানে হবে
    // ==========================================
    // ==========================================
// AUTH & USER RELATED APIS
// ==========================================

// ১. ইউজার ক্রিয়েট বা সেভ করা (ফ্রন্টএন্ড লগইনের পর এটি কল হবে)
app.put('/users', async (req, res) => {
    try {
        const user = req.body;
        const query = { email: user.email };
        
        // চেক করব ইউজার অলরেডি ডাটাবেজে আছে কিনা
        const isExist = await usersCollection.findOne(query);
        
        if (isExist) {
            return res.send({ message: 'User already exists in database', insertedId: null });
        }

        // নতুন ইউজার হলে ডাটাবেজে ইনসার্ট হবে (ডিফল্ট রোল 'buyer')
        const options = { upsert: true };
        const updateDoc = {
            $set: {
                ...user,
                role: user.role || 'buyer', // ফ্রন্টএন্ড থেকে রোল না আসলে ডিফল্ট buyer
                status: 'active'
            },
        };
        const result = await usersCollection.updateOne(query, updateDoc, options);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ২. নির্দিষ্ট ইউজারের রোল চেক করা (ফ্রন্টএন্ড ড্যাশবোর্ড প্রোটেকশনের জন্য)
app.get('/users/role/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);
        res.send({ role: user?.role || null });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

    // Test Route
    app.get('/', (req, res) => {
        res.send('ReSell Hub Server is running smoothly!');
    });

  } finally {
    // Flows open, don't close client permanently
  }
}
run().catch(console.dir);

// Global Error Handler (504/404 এড়ানোর জন্য)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send({ message: 'Something went wrong on the server!' });
});

app.listen(port, () => {
    console.log(`Server is speeding on port ${port}`);
});