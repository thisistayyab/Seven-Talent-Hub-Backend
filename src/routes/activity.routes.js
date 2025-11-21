import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getAllActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
  getActivitiesByConsultant,
  getActivitiesByClient,
} from "../controllers/activity.controller.js";

const router = Router();

router.route("/").get(verifyJWT, getAllActivities);
router.route("/consultant/:consultantId").get(verifyJWT, getActivitiesByConsultant);
router.route("/client/:clientId").get(verifyJWT, getActivitiesByClient);
router.route("/:id").get(verifyJWT, getActivityById);
router.route("/").post(verifyJWT, createActivity);
router.route("/:id").patch(verifyJWT, updateActivity);
router.route("/:id").delete(verifyJWT, deleteActivity);

export { router as activityRouter };



