import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabase, supabaseAdmin } from "../utils/supabaseClient.js";
import { sendMail } from "../utils/sendMail.js";
import { wrapEmail } from "../utils/emailTemplate.js";
import { redisClient } from "../utils/redisClient.js";
import bcrypt from "bcrypt";

const loginUser = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw new ApiError(400, "Username and password are required");
  }

  // Find user by username or email using service role (bypasses RLS)
  // Try username first, then email
  let profile = null;
  let profileError = null;
  
  // Try to find by username
  const { data: profileByUsername, error: errorByUsername } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("username", username)
    .maybeSingle();
  
  if (profileByUsername && !errorByUsername) {
    profile = profileByUsername;
  } else {
    // Try to find by email
    const { data: profileByEmail, error: errorByEmail } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("email", username) // username param might be email
      .maybeSingle();
    
    if (profileByEmail && !errorByEmail) {
      profile = profileByEmail;
    } else {
      profileError = errorByEmail || errorByUsername;
    }
  }

  if (profileError || !profile) {
    throw new ApiError(401, "Invalid credentials");
  }

  if (!profile.active) {
    throw new ApiError(403, "Account is deactivated");
  }

  // Verify password with Supabase Auth using Admin API
  const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
    email: profile.email,
    password: password,
  });

  if (authError || !authData.session) {
    throw new ApiError(401, "Invalid credentials");
  }

  // Get full profile data (no password_hash in profiles - handled by Supabase Auth)
  const userWithoutPassword = { ...profile };

  res.status(200).json(
    new ApiResponse(
      200,
      {
        user: userWithoutPassword,
        session: authData.session,
      },
      "User logged in successfully"
    )
  );
});

const logoutUser = asyncHandler(async (req, res) => {
  // Supabase handles session management, just clear backend state if needed
  res.status(200).json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  // Use Supabase to refresh session
  const { data: { session }, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (error || !session) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  res.status(200).json(
    new ApiResponse(
      200,
      { session },
      "Access token refreshed"
    )
  );
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!oldPassword || !newPassword) {
    throw new ApiError(400, "Old password and new password are required");
  }

  // Get user email from profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    throw new ApiError(404, "User not found");
  }

  // Verify old password first by attempting to sign in
  const { error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
    email: profile.email,
    password: oldPassword,
  });

  if (verifyError) {
    throw new ApiError(400, "Invalid old password");
  }

  // Update password using Supabase Auth Admin API
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { password: newPassword }
  );

  if (updateError) {
    throw new ApiError(500, "Failed to update password");
  }

  res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { data: user, error } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, username, role, phone, address, bio, active, client_id, created_at, updated_at")
    .eq("id", userId)
    .single();

  if (error || !user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(new ApiResponse(200, user, "User fetched successfully"));
});

const updateAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { name, phone, address, bio } = req.body;
  let profilepic = req.file;

  const updateData = {};
  if (name) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (address !== undefined) updateData.address = address;
  if (bio !== undefined) updateData.bio = bio;

  // Handle profile picture upload if provided
  if (profilepic) {
    const fileExt = profilepic.originalname.split(".").pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("avatars")
      .upload(fileName, profilepic.buffer, {
        contentType: profilepic.mimetype,
        upsert: false,
      });

    if (!uploadError && uploadData) {
      const { data: publicUrlData } = supabaseAdmin.storage.from("avatars").getPublicUrl(fileName);
      updateData.profile_picture_url = publicUrlData.publicUrl;
    }
  }

  const { data: updatedUser, error } = await supabaseAdmin
    .from("profiles")
    .update(updateData)
    .eq("id", userId)
    .select("id, name, email, username, role, phone, address, bio, profile_picture_url, active, client_id")
    .single();

  if (error) {
    throw new ApiError(500, "Failed to update account");
  }

  res.status(200).json(new ApiResponse(200, updatedUser, "Account updated successfully"));
});

const getAllUsers = asyncHandler(async (req, res) => {
  const { data: users, error } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, username, role, phone, address, bio, active, client_id, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch users");
  }

  res.status(200).json(new ApiResponse(200, users, "Users fetched successfully"));
});

const createUser = asyncHandler(async (req, res) => {
  const { name, email, username, password, role, phone, address, bio } = req.body;

  if (!name || !email || !username || !role) {
    throw new ApiError(400, "Name, email, username, and role are required");
  }

  // Check if user already exists (check username and email separately)
  const { data: existingByUsername } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
    
  const { data: existingByEmail } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
    
  const existingProfile = existingByUsername || existingByEmail;

  if (existingProfile) {
    throw new ApiError(409, "User with this username or email already exists");
  }

  // Create user in Supabase Auth
  const tempPassword = password || `Tmp!${Math.random().toString(36).slice(2)}${Date.now()}`;
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      name,
      username,
      role: role.toLowerCase(),
    },
  });

  if (authError || !authUser.user) {
    throw new ApiError(500, `Failed to create user: ${authError?.message}`);
  }

  // Profile will be created automatically by trigger, but update it with additional info
  const { data: newProfile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      name,
      username,
      role: role.toLowerCase(),
      phone: phone || null,
      address: address || null,
      bio: bio || null,
      active: true,
    })
    .eq("id", authUser.user.id)
    .select("id, name, email, username, role, phone, address, bio, active, client_id")
    .single();

  if (profileError) {
    // If profile update fails, try to delete the auth user
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
    throw new ApiError(500, "Failed to create user profile");
  }

  // Always send invite email with setup link (admin doesn't set password)
  try {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await redisClient.setEx(`invite:${authUser.user.id}`, 60 * 60 * 24 * 7, token); // 7 days

    const linkBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const inviteUrl = `${linkBase}/set-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    const emailHtml = wrapEmail({
      title: "Invitation",
      contentHtml: `
        <p>Bonjour ${name},</p>
        <p>Un compte vous a été créé sur <strong>Seven Talent Hub</strong>.</p>
        <p>Veuillez définir votre mot de passe pour accéder à la plateforme :</p>
        <p><a class="btn" href="${inviteUrl}">Définir mon mot de passe</a></p>
        <p class="small-note">Ce lien est valable 7 jours.</p>
      `,
    });

    await sendMail({
      to: email,
      subject: "Bienvenue sur Seven Talent Hub - Définissez votre mot de passe",
      html: emailHtml,
    });
  } catch (e) {
    console.error('Invite email error:', e);
  }

  res.status(201).json(new ApiResponse(201, newProfile, "User created successfully"));
});

const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, email, username, password, role, phone, address, bio, active } = req.body;

  // Check if user exists
  const { data: existingUser, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .eq("id", id)
    .single();

  if (fetchError || !existingUser) {
    throw new ApiError(404, "User not found");
  }

  // Check for duplicate username/email
  if (username || email) {
    const escapedUsername = (username || "").replace(/'/g, "''");
    const escapedEmail = (email || "").replace(/'/g, "''");
    
    const orConditions = [];
    if (username) orConditions.push(`username.eq."${escapedUsername}"`);
    if (email) orConditions.push(`email.eq."${escapedEmail}"`);
    
    if (orConditions.length > 0) {
      const { data: duplicateUser } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .neq("id", id)
        .or(orConditions.join(','))
        .maybeSingle();

      if (duplicateUser) {
        throw new ApiError(409, "Username or email already in use");
      }
    }
  }

  // Update password if provided
  if (password) {
    const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      password: password,
    });

    if (passwordError) {
      throw new ApiError(500, "Failed to update password");
    }
  }

  // Update email if changed
  if (email && email !== existingUser.email) {
    const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      email: email,
    });

    if (emailError) {
      throw new ApiError(500, "Failed to update email");
    }
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (username !== undefined) updateData.username = username;
  if (role !== undefined) updateData.role = role.toLowerCase();
  if (phone !== undefined) updateData.phone = phone;
  if (address !== undefined) updateData.address = address;
  if (bio !== undefined) updateData.bio = bio;
  if (active !== undefined) updateData.active = active;

  const { data: updatedUser, error } = await supabaseAdmin
    .from("profiles")
    .update(updateData)
    .eq("id", id)
    .select("id, name, email, username, role, phone, address, bio, active, client_id")
    .single();

  if (error) {
    throw new ApiError(500, "Failed to update user");
  }

  res.status(200).json(new ApiResponse(200, updatedUser, "User updated successfully"));
});

const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Delete from Supabase Auth (this will cascade delete profile due to foreign key)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);

  if (error) {
    throw new ApiError(500, "Failed to delete user");
  }

  res.status(200).json(new ApiResponse(200, {}, "User deleted successfully"));
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  // Check if user exists
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email")
    .eq("email", email)
    .single();

  if (!profile) {
    // Don't reveal if user exists or not for security
    return res.status(200).json(new ApiResponse(200, {}, "If the email exists, a reset link has been sent"));
  }

  // Generate reset code and send via custom SMTP (not using Supabase email)
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store reset code in Redis
  try {
    await redisClient.setEx(`reset_code:${profile.id}`, 600, resetCode);
  } catch (redisError) {
    console.error("Redis error:", redisError);
    throw new ApiError(500, "Failed to generate reset code");
  }

  // Send email with reset code via custom SMTP
  const emailHtml = wrapEmail({
    title: "Réinitialisation de mot de passe",
    contentHtml: `
      <p>Bonjour ${profile.name},</p>
      <p>Vous avez demandé à réinitialiser votre mot de passe. Utilisez le code suivant :</p>
      <p style="font-size: 32px; font-weight: bold; text-align: center; letter-spacing: 8px; margin: 20px 0;">${resetCode}</p>
      <p class="small-note">Ce code est valide pendant 10 minutes.</p>
    `,
  });

  try {
    await sendMail({
      to: profile.email,
      subject: "Réinitialisation de mot de passe - Seven Talent Hub",
      html: emailHtml,
    });
  } catch (emailError) {
    console.error("Email error:", emailError);
    // Don't throw error - still return success for security
  }
  
  // Always return success (don't reveal if email exists)
  return res.status(200).json(new ApiResponse(200, {}, "If the email exists, a reset code has been sent"));
});

const verifyResetCode = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    throw new ApiError(400, "Email and code are required");
  }

  const { data: user, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (error || !user) {
    throw new ApiError(401, "Invalid reset code");
  }

  // Check reset code from Redis
  let storedCode;
  try {
    storedCode = await redisClient.get(`reset_code:${user.id}`);
  } catch (redisError) {
    console.error("Redis error:", redisError);
    throw new ApiError(500, "Failed to verify reset code");
  }

  if (storedCode !== code) {
    throw new ApiError(401, "Invalid reset code");
  }

  res.status(200).json(new ApiResponse(200, { verified: true }, "Reset code verified successfully"));
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    throw new ApiError(400, "Email, code, and new password are required");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (profileError || !profile) {
    throw new ApiError(401, "Invalid reset request");
  }

  // Verify code
  let storedCode;
  try {
    storedCode = await redisClient.get(`reset_code:${profile.id}`);
  } catch (redisError) {
    console.error("Redis error:", redisError);
    throw new ApiError(500, "Failed to verify reset code");
  }

  if (storedCode !== code) {
    throw new ApiError(401, "Invalid reset code");
  }

  // Update password using Supabase Auth
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    password: newPassword,
  });

  if (updateError) {
    throw new ApiError(500, "Failed to reset password");
  }

  // Remove reset code from Redis
  try {
    await redisClient.del(`reset_code:${profile.id}`);
  } catch (redisError) {
    console.error("Redis error:", redisError);
  }

  res.status(200).json(new ApiResponse(200, {}, "Password reset successfully"));
});

// Send or resend an invite link to a user by email (admin-only)
const sendInvite = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email")
    .eq("email", email)
    .single();

  if (!profile) {
    throw new ApiError(404, "User not found");
  }

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await redisClient.setEx(`invite:${profile.id}`, 60 * 60 * 24 * 7, token);

  const linkBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const inviteUrl = `${linkBase}/set-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  const emailHtml = wrapEmail({
    title: "Invitation",
    contentHtml: `
      <p>Bonjour ${profile.name},</p>
      <p>Voici votre lien pour définir un mot de passe et accéder à la plateforme.</p>
      <p><a class="btn" href="${inviteUrl}">Définir mon mot de passe</a></p>
      <p class="small-note">Ce lien est valable 7 jours.</p>
    `,
  });

  await sendMail({
    to: email,
    subject: "Invitation Seven Talent Hub",
    html: emailHtml,
  });

  res.status(200).json(new ApiResponse(200, {}, "Invite sent"));
});

// Accept invite: set password using one-time token and auto-login
const acceptInvite = asyncHandler(async (req, res) => {
  const { email, token, password } = req.body;

  if (!email || !token || !password) {
    throw new ApiError(400, "Email, token and password are required");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, username, role, active")
    .eq("email", email)
    .single();

  if (profileError || !profile) {
    throw new ApiError(404, "User not found");
  }

  // Verify token
  const stored = await redisClient.get(`invite:${profile.id}`);
  if (!stored || stored !== token) {
    throw new ApiError(401, "Invalid or expired invite token");
  }

  // Set the password in Supabase Auth
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    password,
  });
  if (updateError) {
    throw new ApiError(500, "Failed to set password");
  }

  // Consume token
  await redisClient.del(`invite:${profile.id}`);

  // Auto-login to return session
  const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
    email: profile.email,
    password,
  });
  if (authError || !authData?.session) {
    throw new ApiError(500, "Failed to create session");
  }

  res.status(200).json(new ApiResponse(200, { user: profile, session: authData.session }, "Invite accepted"));
});

const requestEmailChange = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { newEmail } = req.body;

  if (!newEmail) {
    throw new ApiError(400, "New email is required");
  }

  // Check if email is already in use
  const { data: existingUser } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", newEmail)
    .single();

  if (existingUser) {
    throw new ApiError(409, "Email already in use");
  }

  // Generate verification code
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

  // Store verification code in Redis
  try {
    await redisClient.setEx(`email_change:${userId}`, 600, JSON.stringify({ newEmail, code: verificationCode }));
  } catch (redisError) {
    console.error("Redis error:", redisError);
    throw new ApiError(500, "Failed to generate verification code");
  }

  // Send email with verification code
  const { data: user } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .single();

  const emailHtml = wrapEmail({
    title: "Changement d'email",
    contentHtml: `
      <p>Bonjour ${user?.name || "Utilisateur"},</p>
      <p>Vous avez demandé à changer votre adresse email. Utilisez le code suivant pour confirmer :</p>
      <p style="font-size: 32px; font-weight: bold; text-align: center; letter-spacing: 8px; margin: 20px 0;">${verificationCode}</p>
      <p class="small-note">Ce code est valide pendant 10 minutes.</p>
    `,
  });

  try {
    await sendMail({
      to: newEmail,
      subject: "Vérification de changement d'email - Seven Talent Hub",
      html: emailHtml,
    });
  } catch (emailError) {
    console.error("Email error:", emailError);
    throw new ApiError(500, "Failed to send verification email");
  }

  res.status(200).json(new ApiResponse(200, {}, "Verification code sent to new email"));
});

const verifyEmailChange = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { code } = req.body;

  if (!code) {
    throw new ApiError(400, "Verification code is required");
  }

  // Get stored verification data
  let storedData;
  try {
    const data = await redisClient.get(`email_change:${userId}`);
    if (!data) {
      throw new ApiError(401, "Invalid or expired verification code");
    }
    storedData = JSON.parse(data);
  } catch (redisError) {
    console.error("Redis error:", redisError);
    throw new ApiError(500, "Failed to verify code");
  }

  if (storedData.code !== code) {
    throw new ApiError(401, "Invalid verification code");
  }

  // Update email in Supabase Auth
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email: storedData.newEmail,
  });

  if (authError) {
    throw new ApiError(500, "Failed to update email");
  }

  // Update email in profile
  const { data: updatedUser, error } = await supabaseAdmin
    .from("profiles")
    .update({ email: storedData.newEmail })
    .eq("id", userId)
    .select("id, name, email, username, role")
    .single();

  if (error) {
    throw new ApiError(500, "Failed to update email");
  }

  // Remove verification data from Redis
  try {
    await redisClient.del(`email_change:${userId}`);
  } catch (redisError) {
    console.error("Redis error:", redisError);
  }

  res.status(200).json(new ApiResponse(200, updatedUser, "Email changed successfully"));
});

export {
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccount,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  forgotPassword,
  resetPassword,
  verifyResetCode,
  sendInvite,
  acceptInvite,
  requestEmailChange,
  verifyEmailChange,
};
