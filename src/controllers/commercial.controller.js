import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabaseAdmin } from "../utils/supabaseClient.js";

const getAllCommercials = asyncHandler(async (req, res) => {
  // Get all users with commercial roles (admin, user, user_sourcing, user_7options)
  const commercialRoles = ["admin", "user", "user_sourcing", "user_7options"];

  const { data: users, error } = await supabaseAdmin
    .from("profiles")
    .select("id, name")
    .in("role", commercialRoles)
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    throw new ApiError(500, "Failed to fetch commercials");
  }

  res.status(200).json(new ApiResponse(200, users || [], "Commercials fetched successfully"));
});

export { getAllCommercials };



