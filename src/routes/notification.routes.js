import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getAllNotifications,
  getNotificationById,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  clearAllNotifications,
  getNotificationsByRecipient,
} from "../controllers/notification.controller.js";

const router = Router();

router.route("/").get(verifyJWT, getAllNotifications);
router.route("/me").get(verifyJWT, getNotificationsByRecipient);
router.route("/:id").get(verifyJWT, getNotificationById);
router.route("/:id/read").patch(verifyJWT, markNotificationAsRead);
router.route("/read-all").patch(verifyJWT, markAllNotificationsAsRead);
router.route("/clear-all").delete(verifyJWT, clearAllNotifications);

export { router as notificationRouter };



