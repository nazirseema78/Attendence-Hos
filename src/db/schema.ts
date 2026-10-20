import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  real,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const userTypeEnum = pgEnum("user_type", ["admin", "student"]);
/** Punctuality of a Present record. */
export const attendanceStatusEnum = pgEnum("attendance_status", ["on_time", "late"]);
/** Attendance outcome. "absent" rows only exist as explicit admin corrections; ordinary absence is derived. */
export const attendanceStateEnum = pgEnum("attendance_state", ["present", "absent"]);
export const markMethodEnum = pgEnum("mark_method", ["self", "staff"]);
/** failed = biometric rejection (counts toward the limit when counted=true); error = technical failure (never counts). */
export const attemptStateEnum = pgEnum("attempt_state", ["created", "verifying", "succeeded", "failed", "cancelled", "expired", "error"]);
export const enrollmentStatusEnum = pgEnum("enrollment_status", ["pending", "active", "rejected", "retired"]);

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** E.164, e.g. +923001234567 */
  phone: text("phone").notNull().unique(),
  guardianPhone: text("guardian_phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Cloudinary public_id of the registered face photo (authenticated delivery). */
  photoId: text("photo_id"),
  /** Cloudinary public_id of the ID card; may be an image or a PDF. */
  idCardId: text("id_card_id"),
  idCardFormat: text("id_card_format"),
  /** SHA-256 of the device token cookie of the bound phone; null = not bound yet. Unique: one phone, one student. */
  deviceTokenHash: text("device_token_hash").unique(),
  deviceBoundAt: timestamp("device_bound_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Login sessions for both admins and students. The cookie holds a random token; we store its hash. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userType: userTypeEnum("user_type").notNull(),
    userId: uuid("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userType, t.userId)],
);

/** Attendance windows, e.g. 08:00–14:30. Minutes since local midnight at the building; end <= start means it crosses midnight. */
export const attendanceSessions = pgTable("attendance_sessions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  createdAt: createdAt(),
});

/** Single-row table (id = 1). */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  graceMinutes: integer("grace_minutes").notNull().default(30),
});

/** Single-row (id = 1) institution branding shown across the app. Not a tenant boundary. */
export const branding = pgTable("branding", {
  id: integer("id").primaryKey().default(1),
  orgName: text("org_name").notNull(),
  /** #RRGGBB; validated for contrast against white before saving. */
  primaryColor: text("primary_color").notNull(),
  /** Cloudinary public_id of the logo (server-normalised PNG). */
  logoId: text("logo_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByAdminId: uuid("updated_by_admin_id").references(() => admins.id),
});

/** Building network allowlist: single IPs or CIDR ranges, IPv4 or IPv6. */
export const allowedIps = pgTable("allowed_ips", {
  id: serial("id").primaryKey(),
  cidr: text("cidr").notNull().unique(),
  label: text("label"),
  createdAt: createdAt(),
});

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "restrict" }),
    /** Local (building) date the session started on (a 02:00 mark belongs to the previous day's night session). */
    sessionDate: date("session_date").notNull(),
    state: attendanceStateEnum("state").notNull().default("present"),
    /** Punctuality; null for an admin "absent" correction. */
    status: attendanceStatusEnum("status"),
    method: markMethodEnum("method").notNull().default("self"),
    /** The verified attempt that produced a self-marked record (single use). */
    attemptId: uuid("attempt_id").unique().references(() => attendanceAttempts.id),
    markedByAdminId: uuid("marked_by_admin_id").references(() => admins.id),
    /** Snapshot of the occurrence window, so later schedule edits never rewrite history. */
    occurrenceStart: timestamp("occurrence_start", { withTimezone: true }),
    occurrenceEnd: timestamp("occurrence_end", { withTimezone: true }),
    /** Restricted verification metadata (provider, scores, thresholds, enrollment version). */
    verification: jsonb("verification"),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip").notNull(),
    selfieId: text("selfie_id"),
    /** Set when the 90-day retention job removes the selfie file. */
    selfieDeletedAt: timestamp("selfie_deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("attendance_once_per_session").on(t.studentId, t.sessionId, t.sessionDate),
    check("attendance_present_has_status", sql`state <> 'present' OR status IS NOT NULL`),
    index("attendance_date_idx").on(t.sessionDate, t.sessionId),
    index("attendance_marked_at_idx").on(t.markedAt),
  ],
);

/** Rejected attendance attempts, kept so admins can spot abuse or misconfiguration. */
export const rejectedAttempts = pgTable(
  "rejected_attempts",
  {
    id: serial("id").primaryKey(),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip").notNull(),
    reason: text("reason").notNull(),
    attemptId: uuid("attempt_id"),
  },
  (t) => [index("rejected_attempts_at_idx").on(t.at)],
);

/** Registered face reference per student. One active version at a time; older versions are kept as history. */
export const faceEnrollments = pgTable(
  "face_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Cloudinary public_id of the reference photo used for this version. */
    imageId: text("image_id").notNull(),
    status: enrollmentStatusEnum("status").notNull(),
    /** Why a reference was rejected (no face, several faces, blurry...). */
    statusReason: text("status_reason"),
    /** Provider quality metadata from the registration check. */
    quality: jsonb("quality"),
    /** 128-d face descriptor (biometric template). Server-only; never sent to a browser. */
    descriptor: real("descriptor").array(),
    /** Model that produced the descriptor; a different model needs re-registration. */
    model: text("model"),
    createdByAdminId: uuid("created_by_admin_id").references(() => admins.id),
    createdAt: createdAt(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("face_enrollments_version").on(t.studentId, t.version),
    uniqueIndex("face_enrollments_one_active").on(t.studentId).where(sql`status = 'active'`),
    index("face_enrollments_student_idx").on(t.studentId, t.status),
  ],
);

/** Biometric consent given by the student; withdrawal is recorded, not deleted. */
export const biometricConsents = pgTable(
  "biometric_consents",
  {
    id: serial("id").primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    noticeVersion: integer("notice_version").notNull(),
    givenAt: timestamp("given_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [index("biometric_consents_student_idx").on(t.studentId)],
);

/** A short-lived, single-use submission token for one occurrence, bound to one student. */
export const attendanceAttempts = pgTable(
  "attendance_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "restrict" }),
    sessionDate: date("session_date").notNull(),
    occurrenceStart: timestamp("occurrence_start", { withTimezone: true }).notNull(),
    occurrenceEnd: timestamp("occurrence_end", { withTimezone: true }).notNull(),
    state: attemptStateEnum("state").notNull().default("created"),
    /** Unused since self-hosted matching replaced AWS liveness; kept so no data is dropped. */
    livenessSessionId: text("liveness_session_id").unique(),
    enrollmentId: uuid("enrollment_id").references(() => faceEnrollments.id),
    ip: text("ip").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    verification: jsonb("verification"),
    /** True when this submission was a biometric rejection that uses up one of the allowed tries. */
    counted: boolean("counted").notNull().default(false),
  },
  (t) => [
    index("attendance_attempts_student_idx").on(t.studentId, t.sessionId, t.sessionDate),
    index("attendance_attempts_state_idx").on(t.state, t.expiresAt),
  ],
);

/** Audit trail of every admin change to attendance. */
export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: serial("id").primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "restrict" }),
    sessionDate: date("session_date").notNull(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id),
    reason: text("reason").notNull(),
    previous: jsonb("previous"),
    next: jsonb("next").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attendance_corrections_occurrence_idx").on(t.studentId, t.sessionId, t.sessionDate)],
);

/** Failed logins, used to throttle password guessing. */
export const loginFailures = pgTable(
  "login_failures",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_failures_key_idx").on(t.key, t.at)],
);
