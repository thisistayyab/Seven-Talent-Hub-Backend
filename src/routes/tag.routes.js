import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { getAllTags, createTag, deleteTag } from "../controllers/tag.controller.js";

const router = Router();

router.route("/").get(verifyJWT, getAllTags);
router.route("/").post(verifyJWT, createTag);
router.route("/:tag").delete(verifyJWT, deleteTag);

export { router as tagRouter };



