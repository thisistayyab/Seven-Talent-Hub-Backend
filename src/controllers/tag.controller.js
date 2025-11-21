import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabaseAdmin } from "../utils/supabaseClient.js";

const getAllTags = asyncHandler(async (req, res) => {
  // Get all unique tags from consultants
  const { data: consultants, error } = await supabaseAdmin.from("consultants").select("tags");

  if (error) {
    throw new ApiError(500, "Failed to fetch tags");
  }

  // Extract all tags and get unique values
  const allTags = consultants
    .flatMap((c) => c.tags || [])
    .filter((tag) => tag && tag.trim() !== "")
    .filter((tag, index, self) => self.indexOf(tag) === index)
    .sort();

  res.status(200).json(new ApiResponse(200, allTags, "Tags fetched successfully"));
});

const createTag = asyncHandler(async (req, res) => {
  const { tag } = req.body;

  if (!tag || typeof tag !== "string" || tag.trim() === "") {
    throw new ApiError(400, "Tag is required");
  }

  const trimmedTag = tag.trim();

  // Check if tag already exists in any consultant
  const { data: consultants } = await supabaseAdmin.from("consultants").select("tags");

  const allTags = consultants.flatMap((c) => c.tags || []);
  if (allTags.includes(trimmedTag)) {
    res.status(200).json(new ApiResponse(200, trimmedTag, "Tag already exists"));
    return;
  }

  // Tag doesn't need to be stored separately, it's stored in consultant.tags array
  // Just return success
  res.status(200).json(new ApiResponse(200, trimmedTag, "Tag is ready to use"));
});

const deleteTag = asyncHandler(async (req, res) => {
  const { tag } = req.params;

  if (!tag) {
    throw new ApiError(400, "Tag is required");
  }

  // Remove tag from all consultants
  const { data: consultants, error: fetchError } = await supabaseAdmin.from("consultants").select("id, tags");

  if (fetchError) {
    throw new ApiError(500, "Failed to fetch consultants");
  }

  // Update each consultant that has this tag
  const updatePromises = consultants
    .filter((c) => c.tags && c.tags.includes(tag))
    .map((c) => {
      const updatedTags = c.tags.filter((t) => t !== tag);
      return supabaseAdmin
        .from("consultants")
        .update({ tags: updatedTags })
        .eq("id", c.id);
    });

  await Promise.all(updatePromises);

  res.status(200).json(new ApiResponse(200, {}, "Tag deleted successfully"));
});

export { getAllTags, createTag, deleteTag };



