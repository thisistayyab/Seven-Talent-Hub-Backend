import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { supabaseAdmin } from "../utils/supabaseClient.js";
import { redisClient } from "../utils/redisClient.js";
import { sendMail } from "../utils/sendMail.js";
import { wrapEmail } from "../utils/emailTemplate.js";
import { notificationService } from "./notification.controller.js";

const getAllClients = asyncHandler(async (req, res) => {
  const currentUser = req.user;
  let query = supabaseAdmin.from("clients").select("*");

  // Allow 7 options role to view all clients (including seven_opportunity)
  // No filter needed - they can see and add both categories

  const { data: clients, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(500, "Failed to fetch clients");
  }

  res.status(200).json(new ApiResponse(200, clients || [], "Clients fetched successfully"));
});

const getClientById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !client) {
    throw new ApiError(404, "Client not found");
  }

  res.status(200).json(new ApiResponse(200, client, "Client fetched successfully"));
});

const createClient = asyncHandler(async (req, res) => {
  const clientData = req.body;
  const currentUser = req.user;

  // Parse JSON fields if they're strings
  let commercials = clientData.commercials;
  if (typeof commercials === "string") {
    try {
      commercials = JSON.parse(commercials);
    } catch (e) {
      commercials = [];
    }
  }

  const newClient = {
    name: clientData.name,
    type: clientData.type, // 'company' or 'individual'
    category: clientData.category || "seven_opportunity", // Allow 7 options role to choose category
    contact_person: clientData.contactPerson || clientData.contact_person || null,
    email: clientData.email || null,
    phone: clientData.phone || null,
    address: clientData.address || null,
    status: clientData.status || "Prospect",
    commercials: commercials || [],
    company_id: clientData.companyId || clientData.company_id || null,
    role: clientData.role || null, // For individual clients
    last_activity: new Date().toISOString(),
  };

  const { data: createdClient, error } = await supabaseAdmin
    .from("clients")
    .insert(newClient)
    .select("*")
    .single();

  if (error) {
    throw new ApiError(500, `Failed to create client: ${error.message}`);
  }

  // Ensure auth account exists for client (individual or contact email) and send invite
  if (createdClient.email) {
    try {
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', createdClient.email)
        .maybeSingle();

      if (!existingProfile) {
        const role = createdClient.type === 'individual'
          ? (createdClient.category === 'seven_options' ? 'user_7options' : 'user')
          : 'user';
        const tempPassword = `Tmp!${Math.random().toString(36).slice(2)}${Date.now()}`;
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: createdClient.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            name: createdClient.name,
            username: (createdClient.email || '').split('@')[0],
            role,
          },
        });

        if (!authError && authUser?.user?.id) {
          const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
          await redisClient.setEx(`invite:${authUser.user.id}`, 60 * 60 * 24 * 7, token);

          const linkBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
          const inviteUrl = `${linkBase}/set-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(createdClient.email)}`;
          const emailHtml = wrapEmail({
            title: 'Invitation',
            contentHtml: `
              <p>Bonjour ${createdClient.name || ''},</p>
              <p>Votre accès à <strong>Seven Talent Hub</strong> a été créé.</p>
              <p>Veuillez définir votre mot de passe pour vous connecter :</p>
              <p><a class=\"btn\" href=\"${inviteUrl}\">Définir mon mot de passe</a></p>
              <p class=\"small-note\">Ce lien expire dans 7 jours.</p>
            `,
          });
          await sendMail({ to: createdClient.email, subject: 'Invitation Seven Talent Hub', html: emailHtml });
        }
      }
    } catch (inviteErr) {
      console.error('Client invite error:', inviteErr);
    }
  }

  res.status(201).json(new ApiResponse(201, createdClient, "Client created successfully"));
});

const updateClient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clientData = req.body;
  const currentUser = req.user;

  // Check if client exists
  const { data: existingClient, error: fetchError } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existingClient) {
    throw new ApiError(404, "Client not found");
  }

  const updateData = {};
  if (clientData.name !== undefined) updateData.name = clientData.name;
  if (clientData.type !== undefined) updateData.type = clientData.type;
  if (clientData.category !== undefined) updateData.category = clientData.category;
  if (clientData.contactPerson !== undefined || clientData.contact_person !== undefined)
    updateData.contact_person = clientData.contactPerson || clientData.contact_person;
  if (clientData.email !== undefined) updateData.email = clientData.email;
  if (clientData.phone !== undefined) updateData.phone = clientData.phone;
  if (clientData.address !== undefined) updateData.address = clientData.address;
  if (clientData.status !== undefined) updateData.status = clientData.status;
  if (clientData.companyId !== undefined || clientData.company_id !== undefined)
    updateData.company_id = clientData.companyId || clientData.company_id;
  if (clientData.role !== undefined) updateData.role = clientData.role;

  if (clientData.commercials !== undefined) {
    updateData.commercials =
      typeof clientData.commercials === "string"
        ? JSON.parse(clientData.commercials)
        : clientData.commercials;
  }

  updateData.last_activity = new Date().toISOString();

  // Allow 7 options role to add/view 7 opportunity clients
  // No restriction on category

  const { data: updatedClient, error } = await supabaseAdmin
    .from("clients")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new ApiError(500, `Failed to update client: ${error.message}`);
  }

  // Emit Socket.IO event for real-time updates
  const io = req.app.get('io');
  if (io && updatedClient) {
    io.emit('client:updated', updatedClient);
  }

  res.status(200).json(new ApiResponse(200, updatedClient, "Client updated successfully"));
});

const deleteClient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if it's a company, and if so, unlink individuals
  const { data: clientToDelete } = await supabaseAdmin
    .from("clients")
    .select("type")
    .eq("id", id)
    .single();

  if (clientToDelete && clientToDelete.type === "company") {
    // Unlink individuals
    await supabaseAdmin
      .from("clients")
      .update({ company_id: null })
      .eq("company_id", id)
      .eq("type", "individual");
  }

  const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);

  if (error) {
    throw new ApiError(500, "Failed to delete client");
  }

  res.status(200).json(new ApiResponse(200, {}, "Client deleted successfully"));
});

const searchClients = asyncHandler(async (req, res) => {
  const { search, category, status, commercialId, type } = req.query;
  const currentUser = req.user;

  let query = supabaseAdmin.from("clients").select("*");

  // Allow 7 options role to view all clients (including seven_opportunity)
  // No filter needed

  if (search) {
    query = query.or(`name.ilike.%${search}%,contact_person.ilike.%${search}%`);
  }

  if (category && category !== "all") {
    query = query.eq("category", category);
  }

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (type && type !== "all") {
    query = query.eq("type", type);
  }

  if (commercialId && commercialId !== "all") {
    query = query.contains("commercials", [{ id: commercialId }]);
  }

  query = query.order("created_at", { ascending: false });

  const { data: clients, error } = await query;

  if (error) {
    throw new ApiError(500, "Failed to search clients");
  }

  res.status(200).json(new ApiResponse(200, clients || [], "Clients fetched successfully"));
});

export { getAllClients, getClientById, createClient, updateClient, deleteClient, searchClients };





