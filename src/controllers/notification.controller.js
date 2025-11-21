import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabaseAdmin } from "../utils/supabaseClient.js";

const addNotification = async (notificationData) => {
  const newNotification = {
    type: notificationData.type,
    message: notificationData.message,
    entity_type: notificationData.entity_type || notificationData.entityType || null,
    entity_id: notificationData.entity_id || notificationData.entityId || null,
    recipient_id: notificationData.recipient_id || notificationData.recipientId,
    read: false,
    timestamp: notificationData.timestamp || new Date().toISOString(),
  };

  const { data: createdNotification, error } = await supabaseAdmin
    .from("notifications")
    .insert(newNotification)
    .select("*")
    .single();

  if (error) {
    console.error("Failed to create notification:", error);
    return null;
  }

  return createdNotification;
};

const getAllNotifications = asyncHandler(async (req, res) => {
  const { data: notifications, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .order("timestamp", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch notifications");
  }

  res.status(200).json(new ApiResponse(200, notifications || [], "Notifications fetched successfully"));
});

const getNotificationById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: notification, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !notification) {
    throw new ApiError(404, "Notification not found");
  }

  res.status(200).json(new ApiResponse(200, notification, "Notification fetched successfully"));
});

const getNotificationsByRecipient = asyncHandler(async (req, res) => {
  const recipientId = req.user.id;

  const { data: notifications, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("recipient_id", recipientId)
    .order("timestamp", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch notifications");
  }

  res.status(200).json(new ApiResponse(200, notifications || [], "Notifications fetched successfully"));
});

const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: updatedNotification, error } = await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !updatedNotification) {
    throw new ApiError(404, "Notification not found");
  }

  res.status(200).json(new ApiResponse(200, updatedNotification, "Notification marked as read"));
});

const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const recipientId = req.user.id;

  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("recipient_id", recipientId)
    .eq("read", false);

  if (error) {
    throw new ApiError(500, "Failed to update notifications");
  }

  res.status(200).json(new ApiResponse(200, {}, "All notifications marked as read"));
});

const clearAllNotifications = asyncHandler(async (req, res) => {
  const recipientId = req.user.id;

  const { error } = await supabaseAdmin
    .from("notifications")
    .delete()
    .eq("recipient_id", recipientId);

  if (error) {
    throw new ApiError(500, "Failed to clear notifications");
  }

  res.status(200).json(new ApiResponse(200, {}, "All notifications cleared"));
});

export {
  addNotification,
  getAllNotifications,
  getNotificationById,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  clearAllNotifications,
  getNotificationsByRecipient,
};

// Export as service for use in other controllers
export const notificationService = {
  addNotification,
};



