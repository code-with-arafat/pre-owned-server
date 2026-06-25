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

// ==========================================
// PRODUCTS RELATED APIS (With Search, Sort, Pagination)
// ==========================================

// ১. সব প্রোডাক্ট গেট করা (With Search, Filter, Sort & Pagination)
// Public Route: All Products Page-এ ব্যবহার হবে
app.get('/products', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;
        const search = req.query.search || '';
        const category = req.query.category || '';
        const sortOrder = req.query.sort || ''; // 'low-to-high' ba 'high-to-low'

        // Advanced Search & Category Filtering Query
        let query = {
            status: 'available', // শুধু যেগুলো বিক্রির জন্য অ্যাভেইলেবল আছে
            title: { $regex: search, $options: 'i' } // আংশিক নাম মিললেও খুঁজে পাবে (Case-insensitive)
        };

        if (category) {
            query.category = category;
        }

        // Advanced Sorting Logic (Price Low to High / High to Low)
        let sortOptions = {};
        if (sortOrder === 'low-to-high') {
            sortOptions.price = 1; // আরোহী ক্রমে (1)
        } else if (sortOrder === 'high-to-low') {
            sortOptions.price = -1; // অবরোহী ক্রমে (-1)
        } else {
            sortOptions._id = -1; // ডিফল্ট: লেটেস্ট প্রোডাক্ট আগে দেখাবে
        }

        // Pagination Logic
        const skip = (page - 1) * size;
        const cursor = productsCollection.find(query).sort(sortOptions).skip(skip).limit(size);
        const result = await cursor.toArray();

        // মোট কতগুলো প্রোডাক্ট আছে তা গোনা (ফ্রন্টএন্ডে টোটাল পেজ দেখানোর জন্য)
        const totalProducts = await productsCollection.countDocuments(query);

        res.send({
            totalProducts,
            totalPages: Math.ceil(totalProducts / size),
            currentPage: page,
            products: result
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ২. নতুন প্রোডাক্ট যোগ করা (Seller Dashboard Feature)
// Private Route: verifyToken মিডলওয়্যার ব্যবহার করা হয়েছে
app.post('/products', verifyToken, async (req, res) => {
    try {
        const product = req.body;
        const result = await productsCollection.insertOne({
            ...product,
            status: 'available', // নতুন প্রোডাক্ট ডিফল্টভাবে available থাকবে
            createdAt: new Date()
        });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৩. নির্দিষ্ট বিক্রেতার প্রোডাক্টগুলো দেখা (My Products Page)
app.get('/products/seller/:email', verifyToken, async (req, res) => {
    try {
        const email = req.params.email;
        // সিকিউরিটি চেক: যে ইউজার টোকেন পাঠিয়েছে সে নিজের ডেটা দেখছে কিনা
        if (req.decoded.email !== email) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        const query = { 'sellerInfo.email': email };
        const result = await productsCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৪. প্রোডাক্ট ডিলিট করা (Seller / Admin Feature)
app.delete('/products/:id', verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await productsCollection.deleteOne(query);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৫. সিঙ্গেল প্রোডাক্ট ডিটেইলস দেখা (Product Details Page)
app.get('/products/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await productsCollection.findOne(query);
        if (!result) return res.status(404).send({ message: 'Product not found' });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ==========================================
// ORDERS & STRIPE PAYMENT APIS
// ==========================================

// ১. Stripe Payment Intent তৈরি করা (Checkout Page-এর জন্য)
// Private Route
app.post('/create-payment-intent', verifyToken, async (req, res) => {
    try {
        const { price } = req.body;
        
        // স্ট্রাইপ সেন্ট (cents)-এ হিসাব করে, তাই ১০০০ টাকা হলে ১০০০ * ১০০ দিতে হবে
        const amount = parseInt(price * 100); 
        
        if (!price || amount < 1) {
            return res.status(400).send({ message: 'Invalid price amount' });
        }

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'bdt', // অথবা 'usd' আপনার টেস্ট অ্যাকাউন্টের কারেন্সি অনুযায়ী
            payment_method_types: ['card'],
        });

        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ২. পেমেন্ট সাকসেসফুল হওয়ার পর অর্ডার ও পেমেন্ট হিস্ট্রি সেভ করা
// Private Route
app.post('/payments', verifyToken, async (req, res) => {
    try {
        const payment = req.body;
        
        // ক) পেমেন্ট কালেকশনে ট্রানজেকশন ডেটা ইনসার্ট করা
        const paymentResult = await paymentsCollection.insertOne(payment);

        // খ) অর্ডার কালেকশনে নতুন একটি সফল অর্ডার তৈরি করা
        const orderData = {
            buyerInfo: {
                userId: payment.buyerId,
                name: payment.buyerName,
                email: payment.buyerEmail
            },
            sellerInfo: {
                userId: payment.sellerId,
                name: payment.sellerName,
                email: payment.sellerEmail
            },
            productId: payment.productId,
            transactionId: payment.transactionId,
            amount: payment.amount,
            paymentStatus: 'paid',
            orderStatus: 'processing', // ডিফল্ট ফ্লো শুরু হলো
            createdAt: new Date()
        };
        const orderResult = await ordersCollection.insertOne(orderData);

        // গ) প্রোডাক্টের স্ট্যাটাস 'available' থেকে 'sold' করে দেওয়া যেন অন্য কেউ আর কিনতে না পারে
        const filter = { _id: new ObjectId(payment.productId) };
        const updateDoc = {
            $set: { status: 'sold' }
        };
        await productsCollection.updateOne(filter, updateDoc);

        res.send({ paymentResult, orderResult });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৩. ক্রেতার নিজের পেমেন্ট হিস্ট্রি ও অর্ডার দেখা (My Orders / Payment History)
app.get('/orders/buyer/:email', verifyToken, async (req, res) => {
    try {
        const email = req.params.email;
        if (req.decoded.email !== email) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        const query = { 'buyerInfo.email': email };
        const result = await ordersCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৪. বিক্রেতার কাছে আসা অর্ডারগুলো দেখা (Manage Orders for Seller)
app.get('/orders/seller/:email', verifyToken, async (req, res) => {
    try {
        const email = req.params.email;
        if (req.decoded.email !== email) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        const query = { 'sellerInfo.email': email };
        const result = await ordersCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৫. অর্ডারের ডেলিভারি স্ট্যাটাস আপডেট করা (Pending -> Accepted -> Delivered)
app.patch('/orders/:id', verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body; // ফ্রন্টএন্ড থেকে 'processing', 'shipped' বা 'delivered' আসবে
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: { orderStatus: status }
        };
        const result = await ordersCollection.updateOne(filter, updateDoc);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ==========================================
// ADMIN DASHBOARD & ANALYTICS APIS
// ==========================================

// ১. প্ল্যাটফর্মের ওভারঅল স্ট্যাটিস্টিকস (Home Page & Admin Dashboard-এর জন্য)
// Public/Private Route
app.get('/admin-stats', async (req, res) => {
    try {
        const totalUsers = await usersCollection.estimatedDocumentCount();
        const totalProducts = await productsCollection.estimatedDocumentCount();
        const totalOrders = await ordersCollection.estimatedDocumentCount();
        
        // মোট কত টাকা সেল হয়েছে (Revenue) তা বের করার লজিক
        const payments = await paymentsCollection.find().toArray();
        const totalRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);

        // সেলারদের জন্য আলাদা কাউন্ট (অপশনাল কিন্তু ড্যাশবোর্ডের জন্য জোস)
        const totalSellers = await usersCollection.countDocuments({ role: 'seller' });
        const totalBuyers = await usersCollection.countDocuments({ role: 'buyer' });

        res.send({
            totalUsers,
            totalProducts,
            totalOrders,
            totalRevenue,
            totalSellers,
            totalBuyers
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
} );

// ২. ক্যাটাগরি ভিত্তিক প্রোডাক্টের সংখ্যা (Admin & Seller Charts-এর জন্য ডাইনামিক ডেটা)
app.get('/category-stats', async (req, res) => {
    try {
        const stats = await productsCollection.aggregate([
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();
        
        res.send(stats);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৩. সব ইউজারদের লিস্ট দেখা (Admin Only)
app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৪. ইউজারের স্ট্যাটাস আপডেট করা (Block/Unblock User - Admin Only)
app.patch('/users/status/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body; // 'active' ba 'blocked' আসবে
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: { status: status }
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৫. ইউজার অ্যাকাউন্ট ডিলিট করা (Admin Only)
app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await usersCollection.deleteOne(query);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// ৬. প্রোডাক্ট রিভিউ/মডারেশন করা (Approve/Reject Product - Admin Only)
app.patch('/products/moderate/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body; // 'available' (Approve) অথবা 'rejected' আসবে
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: { status: status }
        };
        const result = await productsCollection.updateOne(filter, updateDoc);
        res.send(result);
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