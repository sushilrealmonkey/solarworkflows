import assert from "node:assert/strict";
import test from "node:test";
import {
  appendTeamMemberDraft,
  createTeamMemberDraft,
  friendlyTeamInviteError,
  inviteTeamMemberDrafts,
  removeTeamMemberDraft,
  runTeamSetupTransition,
  runTeamSubmissionLock,
  updateTeamMemberDraftValue,
  validateTeamMemberDrafts,
} from "./onboardingTeamSetup.ts";

const roles = [
  role("role-admin", "admin", "Admin"),
  role("role-sales", "sales_team", "Sales"),
  role("role-backend", "backend_team", "Backend"),
  role("role-accounts", "accounts", "Accounts"),
  role("role-field", "field_staff", "Field Staff"),
];

const progress = {
  company_id: "company-1",
  organization_id: "organization-1",
  setup_owner_profile_id: "owner-1",
  setup_owner_assigned_at: "2026-08-14T00:00:00Z",
  onboarding_version: 1,
  status: "in_progress",
  current_step: "team",
  started_at: "2026-08-14T00:00:00Z",
  deferred_at: null,
  completed_at: null,
  completed_by_profile_id: null,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};

test("team setup starts with one blank member row", () => {
  const rows = [createTeamMemberDraft("row-1")];
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].values, {
    full_name: "",
    phone: "",
    email: "",
    role_id: "",
    status: "invited",
  });
});

test("Add Another Team Member appends a row", () => {
  const rows = appendTeamMemberDraft(
    [createTeamMemberDraft("row-1")],
    createTeamMemberDraft("row-2"),
  );
  assert.deepEqual(rows.map((row) => row.id), ["row-1", "row-2"]);
});

test("removing the final row keeps one blank replacement", () => {
  const rows = removeTeamMemberDraft(
    [createTeamMemberDraft("row-1")],
    "row-1",
    createTeamMemberDraft("replacement"),
  );
  assert.deepEqual(rows.map((row) => row.id), ["replacement"]);
});

test("completely blank rows are ignored", async () => {
  let calls = 0;
  const result = await inviteTeamMemberDrafts(
    [createTeamMemberDraft("row-1")],
    roles,
    [],
    async () => {
      calls += 1;
      return {};
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.allInvited, true);
  assert.equal(result.validationBlocked, false);
});

test("partially populated rows require name, email, and role", async () => {
  const row = populatedRow("row-1", { full_name: "Rahul Sharma" });
  const result = await inviteTeamMemberDrafts([row], roles, [], async () => ({}));
  assert.equal(result.validationBlocked, true);
  assert.equal(result.rows[0].errors.email, "Email is required to send the invitation.");
  assert.equal(result.rows[0].errors.role_id, "Select a role.");
});

test("invalid email is blocked before invitation", async () => {
  let calls = 0;
  const row = populatedRow("row-1", {
    full_name: "Rahul Sharma",
    email: "not-an-email",
    role_id: roles[1].id,
  });
  const result = await inviteTeamMemberDrafts([row], roles, [], async () => {
    calls += 1;
    return {};
  });
  assert.equal(result.rows[0].errors.email, "Enter a valid email address.");
  assert.equal(calls, 0);
});

test("missing and unknown roles are blocked", () => {
  const missing = populatedRow("missing", {
    full_name: "Rahul Sharma",
    email: "rahul@example.com",
  });
  const unknown = populatedRow("unknown", {
    full_name: "Priya Shah",
    email: "priya@example.com",
    role_id: "onboarding-only-role",
  });
  const validated = validateTeamMemberDrafts([missing, unknown], roles, []);
  assert.equal(validated[0].errors.role_id, "Select a role.");
  assert.equal(validated[1].errors.role_id, "Select an available Bizlee role.");
});

test("existing role IDs and labels remain the source of truth", async () => {
  const row = populatedRow("row-1", {
    full_name: "Rahul Sharma",
    email: " RAHUL@EXAMPLE.COM ",
    role_id: roles[1].id,
  });
  const submitted = [];
  await inviteTeamMemberDrafts([row], roles, [], async (values) => {
    submitted.push(values);
    return { id: "staff-1" };
  });
  assert.equal(submitted[0].role_id, "role-sales");
  assert.equal(submitted[0].email, "rahul@example.com");
  assert.deepEqual(roles.map((item) => item.role_name), [
    "Admin", "Sales", "Backend", "Accounts", "Field Staff",
  ]);
});

test("duplicate draft emails are blocked after normalization", async () => {
  const rows = [
    populatedRow("row-1", {
      full_name: "Rahul Sharma",
      email: "RAHUL@example.com",
      role_id: roles[1].id,
    }),
    populatedRow("row-2", {
      full_name: "Rahul Sharma",
      email: " rahul@example.com ",
      role_id: roles[2].id,
    }),
  ];
  const result = await inviteTeamMemberDrafts(rows, roles, [], async () => ({}));
  assert.equal(result.validationBlocked, true);
  assert.equal(result.rows[0].errors.email, "This person is already in your invite list.");
  assert.equal(result.rows[1].errors.email, "This person is already in your invite list.");
});

test("active existing members are caught without recreating backend rules", () => {
  const row = validRow("row-1", "member@example.com");
  const validated = validateTeamMemberDrafts(
    [row],
    roles,
    [staff("member@example.com", "active")],
  );
  assert.equal(validated[0].errors.email, "This team member is already part of your company.");
});

test("pending invitations are identified before invite", () => {
  const row = validRow("row-1", "pending@example.com");
  const validated = validateTeamMemberDrafts(
    [row],
    roles,
    [staff("pending@example.com", "invited")],
  );
  assert.equal(validated[0].errors.email, "This person already has a pending invitation.");
});

test("a valid row uses the existing individual staff invitation contract", async () => {
  const submitted = [];
  const result = await inviteTeamMemberDrafts(
    [validRow("row-1", "rahul@example.com")],
    roles,
    [],
    async (values) => {
      submitted.push(values);
      return { id: "staff-1" };
    },
  );
  assert.deepEqual(submitted, [{
    full_name: "Team Member",
    phone: "",
    email: "rahul@example.com",
    role_id: "role-sales",
    status: "invited",
  }]);
  assert.equal(result.rows[0].status, "invited");
  assert.equal(result.rows[0].invitedStaffId, "staff-1");
});

test("multiple invitations are processed sequentially", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const rows = [
    validRow("row-1", "one@example.com"),
    validRow("row-2", "two@example.com"),
  ];
  const result = await inviteTeamMemberDrafts(rows, roles, [], async (values) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push(values.email);
    await Promise.resolve();
    active -= 1;
    return { id: `staff-${calls.length}` };
  });
  assert.deepEqual(calls, ["one@example.com", "two@example.com"]);
  assert.equal(maximumActive, 1);
  assert.equal(result.invitedCount, 2);
});

test("duplicate in-flight submission is prevented", async () => {
  const lock = { current: false };
  let release;
  let calls = 0;
  const first = runTeamSubmissionLock(lock, async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return "done";
  });
  const duplicate = await runTeamSubmissionLock(lock, async () => {
    calls += 1;
    return "duplicate";
  });
  assert.deepEqual(duplicate, { started: false });
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { started: true, value: "done" });
});

test("partial failure preserves successful invitations and friendly row errors", async () => {
  const rows = [
    validRow("row-1", "one@example.com"),
    validRow("row-2", "two@example.com"),
  ];
  const result = await inviteTeamMemberDrafts(rows, roles, [], async (values) => {
    if (values.email === "two@example.com") throw new Error("internal database payload");
    return { id: "staff-1" };
  });
  assert.deepEqual(result.rows.map((row) => row.status), ["invited", "error"]);
  assert.equal(result.rows[1].error, "We couldn't send this invitation. Please try again.");
});

test("retry skips already invited rows", async () => {
  const calls = [];
  const first = await inviteTeamMemberDrafts(
    [validRow("row-1", "one@example.com"), validRow("row-2", "two@example.com")],
    roles,
    [],
    async (values) => {
      calls.push(values.email);
      if (values.email === "two@example.com") throw new Error("temporary");
      return { id: "staff-1" };
    },
  );
  const retry = await inviteTeamMemberDrafts(first.rows, roles, [], async (values) => {
    calls.push(values.email);
    return { id: "staff-2" };
  });
  assert.deepEqual(calls, ["one@example.com", "two@example.com", "two@example.com"]);
  assert.equal(retry.attemptedCount, 1);
  assert.equal(retry.allInvited, true);
});

test("a failed row can be corrected and retried", async () => {
  const first = await inviteTeamMemberDrafts(
    [validRow("row-1", "wrong@example.com")],
    roles,
    [],
    async () => { throw new Error("temporary"); },
  );
  const corrected = updateTeamMemberDraftValue(
    first.rows[0],
    "email",
    "correct@example.com",
  );
  assert.equal(corrected.status, "draft");
  assert.equal(corrected.error, null);
  const retry = await inviteTeamMemberDrafts([corrected], roles, [], async () => ({ id: "staff-1" }));
  assert.equal(retry.allInvited, true);
});

test("locked invited rows ignore edits", () => {
  const invited = { ...validRow("row-1", "one@example.com"), status: "invited" };
  assert.equal(
    updateTeamMemberDraftValue(invited, "email", "changed@example.com").values.email,
    "one@example.com",
  );
});

test("seat-limit errors retain the existing actionable backend message", () => {
  const message = "Bizlee Core includes 3 total users. Deactivate a user or upgrade to Bizlee Pro.";
  assert.equal(friendlyTeamInviteError(new Error(message)), message);
});

test("all-success flow persists Ready before navigation", async () => {
  assert.deepEqual(await transitionEvents("complete"), [
    "persist:ready", "commit:ready", "navigate:/onboarding/ready",
  ]);
});

test("Skip with no invitations advances to Ready", async () => {
  assert.deepEqual(await transitionEvents("skip"), [
    "persist:ready", "commit:ready", "navigate:/onboarding/ready",
  ]);
});

test("Skip after partial success does not resend or revoke invitations", async () => {
  let inviteCalls = 0;
  let revokeCalls = 0;
  const events = await transitionEvents("skip");
  assert.equal(inviteCalls, 0);
  assert.equal(revokeCalls, 0);
  assert.equal(events.at(-1), "navigate:/onboarding/ready");
});

test("Back returns to Product Setup Choice without touching products", async () => {
  let productMutations = 0;
  const events = await transitionEvents("back");
  assert.equal(productMutations, 0);
  assert.deepEqual(events, [
    "persist:products", "commit:products", "navigate:/onboarding/products",
  ]);
});

function role(id, roleKey, roleName) {
  return {
    id,
    organization_id: "organization-1",
    role_key: roleKey,
    role_name: roleName,
    description: null,
    is_system_role: true,
    permission_count: 1,
    permission_ids: [],
  };
}

function staff(email, status) {
  return {
    id: `staff-${email}`,
    organization_id: "organization-1",
    full_name: "Existing Member",
    phone: null,
    email,
    status,
    last_login_at: null,
    role_id: roles[1].id,
    role_name: roles[1].role_name,
  };
}

function populatedRow(id, overrides) {
  const row = createTeamMemberDraft(id);
  return { ...row, values: { ...row.values, ...overrides } };
}

function validRow(id, email) {
  return populatedRow(id, {
    full_name: "Team Member",
    email,
    role_id: roles[1].id,
  });
}

async function transitionEvents(action) {
  const events = [];
  await runTeamSetupTransition(action, {
    persist: async (nextStep) => {
      events.push(`persist:${nextStep}`);
      return { ...progress, current_step: nextStep };
    },
    commit: (nextProgress) => events.push(`commit:${nextProgress.current_step}`),
    navigate: (route) => events.push(`navigate:${route}`),
  });
  return events;
}
