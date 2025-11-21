import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  searchClients,
} from "../controllers/client.controller.js";

const router = Router();

router.route("/").get(verifyJWT, getAllClients);
router.route("/search").get(verifyJWT, searchClients);
router.route("/:id").get(verifyJWT, getClientById);
router.route("/").post(verifyJWT, createClient);
router.route("/:id").patch(verifyJWT, updateClient);
router.route("/:id").delete(verifyJWT, deleteClient);

export { router as clientRouter };



