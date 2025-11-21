import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getAllConsultants,
  getConsultantById,
  createConsultant,
  updateConsultant,
  deleteConsultant,
  searchConsultants,
} from "../controllers/consultant.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.route("/").get(verifyJWT, getAllConsultants);
router.route("/search").get(verifyJWT, searchConsultants);
router.route("/:id").get(verifyJWT, getConsultantById);
router.route("/").post(verifyJWT, upload.single("cvFile"), createConsultant);
router.route("/:id").patch(verifyJWT, upload.single("cvFile"), updateConsultant);
router.route("/:id").delete(verifyJWT, deleteConsultant);

export { router as consultantRouter };



