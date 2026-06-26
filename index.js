const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// ✅ ঝামেলাহীন CORS কনফিগারেশন (লোকাল ও লাইভ দুই জায়গাতেই বডি ডাটা পাস করবে)
app.use(cors({
    origin: function (origin, callback) {
        callback(null, true);
    },
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

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4lov0r3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Database Collections
    const db = client.db('resellHubDB');
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');
    const reviewsCollection = db.collection('reviews');

    console.log("Successfully connected to MongoDB!");

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

    // ==========================================
    // AUTH & USER RELATED APIS
    // ==========================================

    // ১. ইউজার ক্রিয়েট বা সেভ করা (Upsert Mechanism with Safe Fallback)
    app.put('/users', async (req, res) => {
        try {
            const user = req.body || {}; 
            if (!user.email) {
                return res.status(400).send({ success: false, message: 'Email is required' });
            }

            const query = { email: user.email };
            const options = { upsert: true };
            
            const updateDoc = {
                $set: {
                    name: user.name || "Anonymous",
                    email: user.email,
                    photo: user.photo || "https://placehold.co/150",
                    role: user.role || 'buyer', 
                    status: 'active'
                },
            };

            const result = await usersCollection.updateOne(query, updateDoc, options);
            res.send(result);
        } catch (error) {
            console.error("MongoDB /users put error:", error);
            res.status(500).send({ message: error.message });
        }
    });

    // ২. নির্দিষ্ট ইউজারের রোল চেক করা
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
    // PRODUCTS RELATED APIS
    // ==========================================

    // অল প্রোডাক্ট রিড (পাবলিক ক্যাটালগ ফিল্টারিং ও পেজিনেশন সহ)
    app.get('/products', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const size = parseInt(req.query.size) || 10;
            const search = req.query.search || '';
            const category = req.query.category || '';
            const sortOrder = req.query.sort || '';

            let query = {
                status: 'available',
                title: { $regex: search, $options: 'i' }
            };

            if (category) {
                query.category = category;
            }

            let sortOptions = {};
            if (sortOrder === 'low-to-high') {
                sortOptions.price = 1;
            } else if (sortOrder === 'high-to-low') {
                sortOptions.price = -1;
            } else {
                sortOptions._id = -1;
            }

            const skip = (page - 1) * size;
            const cursor = productsCollection.find(query).sort(sortOptions).skip(skip).limit(size);
            const result = await cursor.toArray();
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

    // 📥 ফ্রন্ট-এন্ড ফরমের সাথে ডাটাবেজ সিঙ্ক করার মেইন এপিআই রাউট (UPDATED)
    app.post('/products', verifyToken, async (req, res) => {
        try {
            const productData = req.body;
            
            // ডাটাবেজে রাইট করার আগে ডাটা টাইপ অবজেক্ট ফরমেটিং স্টাবিলিটি
            const newProduct = {
                title: productData.title,
                category: productData.category,
                condition: productData.condition,
                price: parseFloat(productData.price) || 0,
                originalPrice: parseFloat(productData.originalPrice) || 0,
                yearsOfUse: productData.yearsOfUse,
                location: productData.location,
                phone: productData.phone,
                images: productData.images || [],
                description: productData.description,
                sellerInfo: {
                    userId: productData.sellerInfo?.userId,
                    name: productData.sellerInfo?.name,
                    email: productData.sellerInfo?.email
                },
                status: 'available',
                createdAt: new Date()
            };

            const result = await productsCollection.insertOne(newProduct);
            res.send(result);
        } catch (error) {
            console.error("Error inside POST /products:", error);
            res.status(500).send({ message: error.message });
        }
    });

    // সেলারের নিজস্ব প্রোডাক্টগুলো ড্যাশবোর্ডে দেখার রাউট
    app.get('/products/seller/:email', verifyToken, async (req, res) => {
        try {
            const email = req.params.email;
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

    // প্রোডাক্ট ডিলিট করার রাউট
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

    // সিঙ্গেল প্রোডাক্ট আইডি দিয়ে খোঁজার রাউট
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

    // স্ট্রাইপ পেমেন্ট ইনটেন্ট তৈরি করা (Floating value round ফিক্সড)
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
        try {
            const { price } = req.body;
            const amount = Math.round(parseFloat(price) * 100); // 👈 দশমিকের গুণফল রাউন্ড করার জন্য
            
            if (!price || amount < 1) {
                return res.status(400).send({ message: 'Invalid price amount' });
            }

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'bdt',
                payment_method_types: ['card'],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

    // পেমেন্ট সাকসেসফুল হলে কালেকশন আপডেট করা
    app.post('/payments', verifyToken, async (req, res) => {
        try {
            const payment = req.body;
            const paymentResult = await paymentsCollection.insertOne(payment);

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
                orderStatus: 'processing',
                createdAt: new Date()
            };
            const orderResult = await ordersCollection.insertOne(orderData);

            const filter = { _id: new ObjectId(payment.productId) };
            const updateDoc = { $set: { status: 'sold' } };
            await productsCollection.updateOne(filter, updateDoc);

            res.send({ paymentResult, orderResult });
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

    // বায়ারের অর্ডার দেখার রাউট
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

    // সেলারের অর্ডার রিকোয়েস্ট দেখার রাউট
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

    // অর্ডারের স্ট্যাটাস মডিফাই করা (যেমন- Shipped, Delivered)
    app.patch('/orders/:id', verifyToken, async (req, res) => {
        try {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: { orderStatus: status } };
            const result = await ordersCollection.updateOne(filter, updateDoc);
            res.send(result);
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

    // ==========================================
    // ADMIN DASHBOARD & ANALYTICS APIS
    // ==========================================

    app.get('/admin-stats', async (req, res) => {
        try {
            const totalUsers = await usersCollection.estimatedDocumentCount();
            const totalProducts = await productsCollection.estimatedDocumentCount();
            const totalOrders = await ordersCollection.estimatedDocumentCount();
            
            const payments = await paymentsCollection.find().toArray();
            const totalRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);

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
    });

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

    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const result = await usersCollection.find().toArray();
            res.send(result);
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

    app.patch('/users/status/:id', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: { status: status } };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

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

    app.patch('/products/moderate/:id', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: { status: status } };
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
    // Keep connection alive
  }
}
run().catch(console.dir);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send({ message: 'Something went wrong on the server!' });
});

app.listen(port, () => {
    console.log(`Server is speeding on port ${port}`);
});