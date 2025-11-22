import dotenv from 'dotenv'
dotenv.config()
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO with production-ready configuration
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const envFrontend = process.env.FRONTEND_URL || "http://localhost:5173";
      const allowList = [
        envFrontend,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://7talenthub.vercel.app",
        /https?:\/\/.*\.vercel\.app$/,
        /https?:\/\/.*\.vercel\.app:\d+$/
      ];
      const isAllowed = allowList.some((allowed) => {
        if (allowed instanceof RegExp) return allowed.test(origin);
        return allowed === origin;
      });
      return isAllowed ? callback(null, true) : callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  // Production configuration for Render/Vercel
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  // Enable CORS for Socket.IO
  allowUpgrades: true,
  // Handle connection issues in production
  connectTimeout: 45000,
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Join notification room for user
  socket.on('join:notifications', (userId) => {
    if (userId) {
      const roomName = `notifications:${String(userId)}`;
      socket.join(roomName);
      
      // Send confirmation to client
      socket.emit('notification:room:joined', { userId: String(userId), room: roomName });
    } else {
      console.warn('⚠️ join:notifications called without userId');
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Export io for use in controllers
app.set('io', io);

const port = process.env.PORT || 8000

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const envFrontend = process.env.FRONTEND_URL || "http://localhost:5173";
        const allowList = [
            envFrontend,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "https://7talenthub.vercel.app",
            /https?:\/\/.*\.vercel\.app$/,
            /https?:\/\/.*\.vercel\.app:\d+$/
        ];
        const isAllowed = allowList.some((allowed) => {
            if (allowed instanceof RegExp) return allowed.test(origin);
            return allowed === origin;
        });
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
    optionsSuccessStatus: 200
}))

app.use(express.json({limit:"50mb"}))
app.use(express.urlencoded({extended:true, limit:"50mb"}))
app.use(express.static("public"))
app.use(cookieParser())

// Import routes
import { router } from './routes/user.routes.js';
import { consultantRouter } from './routes/consultant.routes.js';
import { clientRouter } from './routes/client.routes.js';
import { activityRouter } from './routes/activity.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { tagRouter } from './routes/tag.routes.js';
import { commercialRouter } from './routes/commercial.routes.js';

// Use routes
app.use("/v1/api/user", router);
app.use("/v1/api/consultants", consultantRouter);
app.use("/v1/api/clients", clientRouter);
app.use("/v1/api/activities", activityRouter);
app.use("/v1/api/notifications", notificationRouter);
app.use("/v1/api/tags", tagRouter);
app.use("/v1/api/commercials", commercialRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errors: err.errors || [],
    data: null
  });
});

httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
})

export default app
export { io }