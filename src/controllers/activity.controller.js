import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabaseAdmin } from "../utils/supabaseClient.js";
import { notificationService } from "./notification.controller.js";

const getAllActivities = asyncHandler(async (req, res) => {
  const { data: activities, error } = await supabaseAdmin
    .from("activities")
    .select("*")
    .order("timestamp", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch activities");
  }

  res.status(200).json(new ApiResponse(200, activities || [], "Activities fetched successfully"));
});

const getActivityById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: activity, error } = await supabaseAdmin
    .from("activities")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !activity) {
    throw new ApiError(404, "Activity not found");
  }

  res.status(200).json(new ApiResponse(200, activity, "Activity fetched successfully"));
});

const getActivitiesByConsultant = asyncHandler(async (req, res) => {
  const { consultantId } = req.params;

  const { data: activities, error } = await supabaseAdmin
    .from("activities")
    .select("*")
    .eq("consultant_id", consultantId)
    .order("timestamp", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch activities");
  }

  res.status(200).json(new ApiResponse(200, activities || [], "Activities fetched successfully"));
});

const getActivitiesByClient = asyncHandler(async (req, res) => {
  const { clientId } = req.params;

  const { data: activities, error } = await supabaseAdmin
    .from("activities")
    .select("*")
    .eq("client_id", clientId)
    .order("timestamp", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch activities");
  }

  res.status(200).json(new ApiResponse(200, activities || [], "Activities fetched successfully"));
});

const createActivity = asyncHandler(async (req, res) => {
  const activityData = req.body;
  const currentUser = req.user;

  const newActivity = {
    type: activityData.type,
    user: currentUser.name,
    content: activityData.content || null,
    consultant_id: activityData.consultantId || activityData.consultant_id || null,
    consultant_name: activityData.consultantName || activityData.consultant_name || null,
    client_id: activityData.clientId || activityData.client_id || null,
    client_name: activityData.clientName || activityData.client_name || null,
    timestamp: activityData.timestamp || new Date().toISOString(),
    interaction_type: activityData.interactionType || activityData.interaction_type || null,
    assigner_id: activityData.assignerId || activityData.assigner_id || null,
    assignee_id: activityData.assigneeId || activityData.assignee_id || null,
    status: activityData.status || "pending",
    details: activityData.details ? (typeof activityData.details === "string" ? JSON.parse(activityData.details) : activityData.details) : null,
  };

  const { data: createdActivity, error } = await supabaseAdmin
    .from("activities")
    .insert(newActivity)
    .select("*")
    .single();

  if (error) {
    console.log(error)
    throw new ApiError(500, `Failed to create activity: ${error.message}`);
  }

  // Emit Socket.IO event for real-time updates
  const io = req.app.get('io');
  if (io && createdActivity) {
    io.emit('activity:created', createdActivity);
  } else {
    console.warn('⚠️ [Socket.IO] Cannot emit activity:created - io:', !!io, 'createdActivity:', !!createdActivity);
  }

  // Update last_activity for consultant/client
  if (createdActivity.consultant_id) {
    await supabaseAdmin
      .from("consultants")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", createdActivity.consultant_id);
  }

  if (createdActivity.client_id) {
    await supabaseAdmin
      .from("clients")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", createdActivity.client_id);
  }

  // Create notifications
  if (createdActivity.consultant_id) {
    const { data: consultant } = await supabaseAdmin
      .from("consultants")
      .select("id, commercial_id, name")
      .eq("id", createdActivity.consultant_id)
      .single();

    if (consultant && consultant.commercial_id && consultant.commercial_id !== currentUser.id) {
      let notifType = "comment";
      if (createdActivity.type === "call") notifType = "call";
      if (createdActivity.type === "email") notifType = "email";

      try {
        const io = req.app.get('io');
        await notificationService.addNotification({
          type: notifType,
          message: `${currentUser.name} a ajouté une interaction (${createdActivity.type}) sur ${consultant.name}.`,
          entity_type: "consultant",
          entity_id: consultant.id,
          recipient_id: consultant.commercial_id,
        }, io);
      } catch (notifError) {
        console.error("Notification error:", notifError);
      }
    }
  }

  if (createdActivity.client_id) {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, commercials, name")
      .eq("id", createdActivity.client_id)
      .single();

    if (client && client.commercials && Array.isArray(client.commercials)) {
      await Promise.all(
        client.commercials
          .filter((comm) => comm.id && comm.id !== currentUser.id)
          .map(async (comm) => {
            try {
              const io = req.app.get('io');
              await notificationService.addNotification({
                type: "comment",
                message: `${currentUser.name} a ajouté une interaction sur le client ${client.name}.`,
                entity_type: "client",
                entity_id: client.id,
                recipient_id: comm.id,
              }, io);
            } catch (notifError) {
              console.error("Notification error:", notifError);
            }
          })
      );
    }
  }

  // Create notification for todo assignment
  if (createdActivity.type === "todo" && createdActivity.assignee_id && createdActivity.assignee_id !== currentUser.id) {
    const isConsultant = !!createdActivity.consultant_id;
    const entityName = isConsultant ? createdActivity.consultant_name : createdActivity.client_name;
    const entityType = isConsultant ? "consultant" : "client";
    const entityId = isConsultant ? createdActivity.consultant_id : createdActivity.client_id;

    try {
      const io = req.app.get('io');
      await notificationService.addNotification({
        type: "todo",
        message: `${currentUser.name} vous a assigné une tâche concernant ${entityName}.`,
        entity_type: entityType,
        entity_id: entityId,
        recipient_id: createdActivity.assignee_id,
      }, io);
    } catch (notifError) {
      console.error("Notification error:", notifError);
    }
  }

  // Emit Socket.IO event for real-time updates (already done above)
  
  res.status(201).json(new ApiResponse(201, createdActivity, "Activity created successfully"));
});

const updateActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const activityData = req.body;

  const { data: existingActivity, error: fetchError } = await supabaseAdmin
    .from("activities")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existingActivity) {
    throw new ApiError(404, "Activity not found");
  }

  const updateData = {};
  if (activityData.content !== undefined) updateData.content = activityData.content;
  if (activityData.status !== undefined) updateData.status = activityData.status;
  if (activityData.details !== undefined)
    updateData.details =
      typeof activityData.details === "string" ? JSON.parse(activityData.details) : activityData.details;

  const { data: updatedActivity, error } = await supabaseAdmin
    .from("activities")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new ApiError(500, `Failed to update activity: ${error.message}`);
  }

  // Emit Socket.IO event for real-time updates
  const io = req.app.get('io');
  if (io && updatedActivity) {
    io.emit('activity:updated', updatedActivity);
  }

  res.status(200).json(new ApiResponse(200, updatedActivity, "Activity updated successfully"));
});

const deleteActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get activity before deleting to emit socket event
  const { data: activityToDelete } = await supabaseAdmin
    .from("activities")
    .select("*")
    .eq("id", id)
    .single();

  const { error } = await supabaseAdmin.from("activities").delete().eq("id", id);

  if (error) {
    throw new ApiError(500, `Failed to delete activity: ${error.message}`);
  }

  // Emit Socket.IO event for real-time updates
  const io = req.app.get('io');
  if (io && activityToDelete) {
    io.emit('activity:deleted', { id: id, ...activityToDelete });
  }

  res.status(200).json(new ApiResponse(200, {}, "Activity deleted successfully"));
});

export {
  getAllActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
  getActivitiesByConsultant,
  getActivitiesByClient,
};



