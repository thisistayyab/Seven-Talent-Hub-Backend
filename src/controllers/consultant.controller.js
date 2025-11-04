import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabaseAdmin } from "../utils/supabaseClient.js";
import { notificationService } from "./notification.controller.js";

const getAllConsultants = asyncHandler(async (req, res) => {
  const { data: consultants, error } = await supabaseAdmin
    .from("consultants")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch consultants");
  }

  res.status(200).json(new ApiResponse(200, consultants || [], "Consultants fetched successfully"));
});

const getConsultantById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: consultant, error } = await supabaseAdmin
    .from("consultants")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !consultant) {
    throw new ApiError(404, "Consultant not found");
  }

  res.status(200).json(new ApiResponse(200, consultant, "Consultant fetched successfully"));
});

const createConsultant = asyncHandler(async (req, res) => {
  const consultantData = req.body;
  const cvFile = req.file;
  const currentUser = req.user;

  // Handle CV file upload if provided
  let cvFileUrl = null;
  if (cvFile) {
    const fileExt = cvFile.originalname.split(".").pop();
    const fileName = `consultant-cv-${Date.now()}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("consultant-cvs")
      .upload(fileName, cvFile.buffer, {
        contentType: cvFile.mimetype,
        upsert: false,
      });

    if (!uploadError && uploadData) {
      const { data: publicUrlData } = supabaseAdmin.storage
        .from("consultant-cvs")
        .getPublicUrl(fileName);
      cvFileUrl = publicUrlData.publicUrl;
    }
  }

  // Parse JSON fields if they're strings
  let tags = consultantData.tags;
  let experiences = consultantData.experiences;
  let availability = consultantData.availability;

  if (typeof tags === "string") {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = [];
    }
  }

  if (typeof experiences === "string") {
    try {
      experiences = JSON.parse(experiences);
    } catch (e) {
      experiences = [];
    }
  }

  if (typeof availability === "string") {
    try {
      availability = JSON.parse(availability);
    } catch (e) {
      availability = { status: "available", date: null };
    }
  }

  const newConsultant = {
    name: consultantData.name,
    email: consultantData.email || null,
    phone: consultantData.phone || null,
    location: consultantData.location || null,
    role: consultantData.role || null,
    company: consultantData.company || null,
    tags: tags || [],
    years_of_experience: parseInt(consultantData.yearsOfExperience || consultantData.years_of_experience) || 0,
    commercial_id: consultantData.commercialId || consultantData.commercial_id || null,
    availability: availability || { status: "available", date: null },
    cv_file_url: cvFileUrl || consultantData.cvFileUrl || null,
    templated_cv_url: consultantData.templatedCvUrl || null,
    price: parseFloat(consultantData.price) || null,
    english_level: consultantData.englishLevel || consultantData.english_level || null,
    is_permifier: consultantData.isPermifier === true || consultantData.isPermifier === "true",
    is_relocatable: consultantData.isRelocatable === true || consultantData.isRelocatable === "true",
    nationality: consultantData.nationality || null,
    age: parseInt(consultantData.age) || null,
    is_seven_academy: consultantData.isSevenAcademy === true || consultantData.isSevenAcademy === "true",
    seven_academy_training: consultantData.sevenAcademyTraining
      ? (typeof consultantData.sevenAcademyTraining === "string"
          ? JSON.parse(consultantData.sevenAcademyTraining)
          : consultantData.sevenAcademyTraining)
      : null,
    is_favorite: consultantData.isFavorite === true || consultantData.isFavorite === "true",
    is_blacklisted: consultantData.isBlacklisted === true || consultantData.isBlacklisted === "true",
    blacklist_reason: consultantData.blacklistReason || null,
    blacklist_date: consultantData.blacklistDate || null,
    next_followup: consultantData.nextFollowup || null,
    color: consultantData.color || null,
    experiences: experiences || [],
    last_activity: new Date().toISOString(),
    created_by: currentUser.id,
  };

  const { data: createdConsultant, error } = await supabaseAdmin
    .from("consultants")
    .insert(newConsultant)
    .select("*")
    .single();

  if (error) {
    console.log(error)
    throw new ApiError(500, `Failed to create consultant: ${error.message}`);
  }

  // Create notification if consultant is assigned to different user
  if (createdConsultant.commercial_id && createdConsultant.commercial_id !== currentUser.id) {
    try {
      await notificationService.addNotification({
        type: "assignment",
        message: `${currentUser.name} a assigné ${createdConsultant.name} à vous.`,
        entity_type: "consultant",
        entity_id: createdConsultant.id,
        recipient_id: createdConsultant.commercial_id,
      });
    } catch (notifError) {
      console.error("Notification error:", notifError);
    }
  }

  res.status(201).json(new ApiResponse(201, createdConsultant, "Consultant created successfully"));
});

const updateConsultant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const consultantData = req.body;
  const cvFile = req.file;
  const currentUser = req.user;

  // Check if consultant exists
  const { data: existingConsultant, error: fetchError } = await supabaseAdmin
    .from("consultants")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existingConsultant) {
    throw new ApiError(404, "Consultant not found");
  }

  // Handle CV file upload if provided
  let cvFileUrl = existingConsultant.cv_file_url;
  if (cvFile) {
    const fileExt = cvFile.originalname.split(".").pop();
    const fileName = `consultant-cv-${id}-${Date.now()}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("consultant-cvs")
      .upload(fileName, cvFile.buffer, {
        contentType: cvFile.mimetype,
        upsert: false,
      });

    if (!uploadError && uploadData) {
      const { data: publicUrlData } = supabaseAdmin.storage
        .from("consultant-cvs")
        .getPublicUrl(fileName);
      cvFileUrl = publicUrlData.publicUrl;
    }
  }

  // Parse JSON fields if they're strings
  const updateData = {};
  if (consultantData.name !== undefined) updateData.name = consultantData.name;
  if (consultantData.email !== undefined) updateData.email = consultantData.email;
  if (consultantData.phone !== undefined) updateData.phone = consultantData.phone;
  if (consultantData.location !== undefined) updateData.location = consultantData.location;
  if (consultantData.role !== undefined) updateData.role = consultantData.role;
  if (consultantData.company !== undefined) updateData.company = consultantData.company;
  if (consultantData.color !== undefined) updateData.color = consultantData.color;
  if (consultantData.price !== undefined) updateData.price = parseFloat(consultantData.price) || null;
  if (consultantData.englishLevel !== undefined || consultantData.english_level !== undefined)
    updateData.english_level = consultantData.englishLevel || consultantData.english_level;
  if (consultantData.nationality !== undefined) updateData.nationality = consultantData.nationality;
  if (consultantData.age !== undefined) updateData.age = parseInt(consultantData.age) || null;
  if (consultantData.nextFollowup !== undefined) updateData.next_followup = consultantData.nextFollowup || null;
  if (consultantData.templatedCvUrl !== undefined)
    updateData.templated_cv_url = consultantData.templatedCvUrl;
  if (cvFileUrl) updateData.cv_file_url = cvFileUrl;

  if (consultantData.tags !== undefined) {
    updateData.tags =
      typeof consultantData.tags === "string" ? JSON.parse(consultantData.tags) : consultantData.tags;
  }

  if (consultantData.experiences !== undefined) {
    updateData.experiences =
      typeof consultantData.experiences === "string"
        ? JSON.parse(consultantData.experiences)
        : consultantData.experiences;
  }

  if (consultantData.availability !== undefined) {
    updateData.availability =
      typeof consultantData.availability === "string"
        ? JSON.parse(consultantData.availability)
        : consultantData.availability;
  }

  if (consultantData.yearsOfExperience !== undefined || consultantData.years_of_experience !== undefined) {
    updateData.years_of_experience =
      parseInt(consultantData.yearsOfExperience || consultantData.years_of_experience) || 0;
  }

  if (consultantData.commercialId !== undefined || consultantData.commercial_id !== undefined) {
    updateData.commercial_id = consultantData.commercialId || consultantData.commercial_id;
  }

  if (consultantData.isPermifier !== undefined || consultantData.is_permifier !== undefined) {
    updateData.is_permifier =
      consultantData.isPermifier === true ||
      consultantData.isPermifier === "true" ||
      consultantData.is_permifier === true;
  }

  if (consultantData.isRelocatable !== undefined || consultantData.is_relocatable !== undefined) {
    updateData.is_relocatable =
      consultantData.isRelocatable === true ||
      consultantData.isRelocatable === "true" ||
      consultantData.is_relocatable === true;
  }

  if (consultantData.isSevenAcademy !== undefined || consultantData.is_seven_academy !== undefined) {
    updateData.is_seven_academy =
      consultantData.isSevenAcademy === true ||
      consultantData.isSevenAcademy === "true" ||
      consultantData.is_seven_academy === true;
  }

  if (consultantData.sevenAcademyTraining !== undefined) {
    updateData.seven_academy_training =
      typeof consultantData.sevenAcademyTraining === "string"
        ? JSON.parse(consultantData.sevenAcademyTraining)
        : consultantData.sevenAcademyTraining;
  }

  if (consultantData.isFavorite !== undefined || consultantData.is_favorite !== undefined) {
    updateData.is_favorite =
      consultantData.isFavorite === true ||
      consultantData.isFavorite === "true" ||
      consultantData.is_favorite === true;
  }

  if (consultantData.isBlacklisted !== undefined || consultantData.is_blacklisted !== undefined) {
    updateData.is_blacklisted =
      consultantData.isBlacklisted === true ||
      consultantData.isBlacklisted === "true" ||
      consultantData.is_blacklisted === true;
  }

  if (consultantData.blacklistReason !== undefined || consultantData.blacklist_reason !== undefined) {
    updateData.blacklist_reason = consultantData.blacklistReason || consultantData.blacklist_reason;
  }

  if (consultantData.blacklistDate !== undefined || consultantData.blacklist_date !== undefined) {
    updateData.blacklist_date = consultantData.blacklistDate || consultantData.blacklist_date || null;
  }

  updateData.last_activity = new Date().toISOString();

  const { data: updatedConsultant, error } = await supabaseAdmin
    .from("consultants")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.log(error)
    throw new ApiError(500, `Failed to update consultant: ${error.message}`);
  }

  // Create notifications for assignment change
  if (
    updateData.commercial_id !== undefined &&
    existingConsultant.commercial_id !== updateData.commercial_id &&
    updateData.commercial_id
  ) {
    try {
      await notificationService.addNotification({
        type: "assignment",
        message: `${currentUser.name} vous a assigné ${updatedConsultant.name}.`,
        entity_type: "consultant",
        entity_id: updatedConsultant.id,
        recipient_id: updateData.commercial_id,
      });
    } catch (notifError) {
      console.error("Notification error:", notifError);
    }
  }

  // Create notification for availability change
  if (
    updateData.availability &&
    existingConsultant.availability?.status !== "available" &&
    updateData.availability.status === "available" &&
    updatedConsultant.commercial_id
  ) {
    try {
      await notificationService.addNotification({
        type: "availability",
        message: `${updatedConsultant.name} est de nouveau disponible.`,
        entity_type: "consultant",
        entity_id: updatedConsultant.id,
        recipient_id: updatedConsultant.commercial_id,
      });
    } catch (notifError) {
      console.error("Notification error:", notifError);
    }
  }

  res.status(200).json(new ApiResponse(200, updatedConsultant, "Consultant updated successfully"));
});

const deleteConsultant = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin.from("consultants").delete().eq("id", id);

  if (error) {
    throw new ApiError(500, "Failed to delete consultant");
  }

  res.status(200).json(new ApiResponse(200, {}, "Consultant deleted successfully"));
});

const searchConsultants = asyncHandler(async (req, res) => {
  const {
    search,
    tags,
    filterType,
    experienceMin,
    experienceMax,
    commercialId,
    availability,
    priceMin,
    priceMax,
    englishLevel,
    nationality,
    isPermifier,
    isRelocatable,
  } = req.query;

  let query = supabaseAdmin.from("consultants").select("*");

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,role.ilike.%${search}%,company.ilike.%${search}%`);
  }

  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : tags.split(",");
    query = query.contains("tags", tagArray);
  }

  if (filterType) {
    switch (filterType) {
      case "favorites":
        query = query.eq("is_favorite", true);
        break;
      case "blacklist":
        query = query.eq("is_blacklisted", true);
        break;
      case "followup":
        query = query.not("next_followup", "is", null).lte("next_followup", new Date().toISOString());
        break;
      case "my_consultants":
        query = query.eq("commercial_id", req.user.id);
        break;
      case "available":
        query = query.or(
          `availability->>status.eq.available,availability->>status.eq.next_month,availability->>status.eq.custom`
        );
        break;
    }
  }

  if (experienceMin !== undefined) {
    query = query.gte("years_of_experience", parseInt(experienceMin));
  }

  if (experienceMax !== undefined) {
    query = query.lte("years_of_experience", parseInt(experienceMax));
  }

  if (commercialId && commercialId !== "all") {
    query = query.eq("commercial_id", commercialId);
  }

  if (availability && availability !== "all") {
    query = query.eq("availability->>status", availability);
  }

  if (priceMin !== undefined) {
    query = query.gte("price", parseFloat(priceMin));
  }

  if (priceMax !== undefined) {
    query = query.lte("price", parseFloat(priceMax));
  }

  if (englishLevel && englishLevel !== "all") {
    query = query.eq("english_level", englishLevel);
  }

  if (nationality && nationality !== "all") {
    query = query.eq("nationality", nationality);
  }

  if (isPermifier === "true") {
    query = query.eq("is_permifier", true);
  }

  if (isRelocatable === "true") {
    query = query.eq("is_relocatable", true);
  }

  query = query.order("created_at", { ascending: false });

  const { data: consultants, error } = await query;

  if (error) {
    throw new ApiError(500, "Failed to search consultants");
  }

  res.status(200).json(new ApiResponse(200, consultants || [], "Consultants fetched successfully"));
});

export {
  getAllConsultants,
  getConsultantById,
  createConsultant,
  updateConsultant,
  deleteConsultant,
  searchConsultants,
};


