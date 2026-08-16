import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Faltan variables de entorno de Supabase.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);
  if (callerError || !callerData.user) {
    return jsonResponse({ error: 'Sesión no válida.' }, 401);
  }

  const { data: callerAdmin, error: callerAdminError } = await adminClient
    .from('almacen_admins')
    .select('id, activo')
    .eq('id', callerData.user.id)
    .eq('activo', true)
    .maybeSingle();

  if (callerAdminError || !callerAdmin) {
    return jsonResponse({ error: 'No tienes permisos para gestionar administradores.' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'upsert').trim().toLowerCase();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  const activo = body.activo !== false;

  if (action === 'delete') {
    if (!id) {
      return jsonResponse({ error: 'Falta el id del administrador a eliminar.' }, 400);
    }

    if (id === callerData.user.id) {
      return jsonResponse({ error: 'No puedes eliminar tu propio usuario mientras estás conectado.' }, 400);
    }

    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(id);
    if (deleteAuthError && !/not found|does not exist/i.test(deleteAuthError.message)) {
      return jsonResponse({ error: deleteAuthError.message }, 400);
    }

    const { error: deleteProfileError } = await adminClient
      .from('almacen_admins')
      .delete()
      .eq('id', id);

    if (deleteProfileError) {
      return jsonResponse({ error: deleteProfileError.message }, 400);
    }

    return jsonResponse({ ok: true, deleted: true, id });
  }

  if (!username || !email) {
    return jsonResponse({ error: 'Usuario y correo son obligatorios.' }, 400);
  }

  if (!id && !password) {
    return jsonResponse({ error: 'La contraseña es obligatoria para crear un administrador.' }, 400);
  }

  let authUserId = id;

  if (authUserId) {
    const updatePayload: { email?: string; password?: string; user_metadata?: Record<string, string> } = {
      user_metadata: { username },
    };

    if (password) {
      updatePayload.password = password;
    }

    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(authUserId, updatePayload);
    if (updateAuthError) {
      const authUserMissing = /not found|does not exist|no user/i.test(updateAuthError.message);

      if (!authUserMissing || !password) {
        return jsonResponse({ error: updateAuthError.message }, 400);
      }

      const { data: createdUser, error: createMissingAuthError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username },
      });

      if (createMissingAuthError || !createdUser.user) {
        return jsonResponse({
          error: createMissingAuthError?.message || 'No se pudo crear el usuario Auth para este administrador.',
        }, 400);
      }

      const previousProfileId = authUserId;
      authUserId = createdUser.user.id;

      const { error: deletePreviousProfileError } = await adminClient
        .from('almacen_admins')
        .delete()
        .eq('id', previousProfileId);

      if (deletePreviousProfileError) {
        return jsonResponse({ error: deletePreviousProfileError.message }, 400);
      }
    }
  } else {
    const { data: createdUser, error: createAuthError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });

    if (createAuthError || !createdUser.user) {
      return jsonResponse({ error: createAuthError?.message || 'No se pudo crear el usuario Auth.' }, 400);
    }

    authUserId = createdUser.user.id;
  }

  const { error: profileError } = await adminClient
    .from('almacen_admins')
    .upsert({
      id: authUserId,
      username,
      email,
      activo,
    }, { onConflict: 'id' });

  if (profileError) {
    return jsonResponse({ error: profileError.message }, 400);
  }

  return jsonResponse({ ok: true, id: authUserId });
});
