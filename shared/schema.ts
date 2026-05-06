import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  varchar,
  real,
  uuid,
  pgEnum,
  primaryKey,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ============ ENUMS ============

// NOTE: `equipment_id` and `oral_qa` are legacy values kept in the Postgres
// enum for backwards compatibility (dropping enum values in PG is destructive
// and brittle). The data migration rewrites all rows to the new taxonomy
// (`equipment_id` -> `image_id`, `oral_qa` -> `custom`) and the application
// no longer creates rows with the legacy values. Remove from the enum in a
// future cleanup migration once we are confident no row references them.
export const stationTypeEnum = pgEnum("station_type", [
  "history_taking",
  "physical_exam",
  "communication",
  "image_id",
  "custom",
  "qa",
  "equipment_id", // legacy — do not use
  "oral_qa",      // legacy — do not use
]);

export const STATION_TYPES = [
  "history_taking",
  "physical_exam",
  "communication",
  "image_id",
  "qa",
  "custom",
] as const;
export type StationType = (typeof STATION_TYPES)[number];

export const examinerQuestionTypeEnum = pgEnum("examiner_question_type", [
  "free_text",
  "multiple_choice",
  "multi_select",
]);

export const EXAMINER_QUESTION_TYPES = [
  "free_text",
  "multiple_choice",
  "multi_select",
] as const;
export type ExaminerQuestionType = (typeof EXAMINER_QUESTION_TYPES)[number];

export const difficultyEnum = pgEnum("difficulty", [
  "beginner",
  "intermediate",
  "advanced",
]);

export const sessionModeEnum = pgEnum("session_mode", [
  "self_check",
  "ai_history",
  "ai_observer",
  "ai_communication",
]);

export const itemStatusEnum = pgEnum("item_status", [
  "checked",
  "missed",
  "partial",
  "checked_after_time",
]);

// ============ COMMUNITY LIBRARY ENUMS ============

export const visibilityEnum = pgEnum("visibility", [
  "private",
  "shared",
  "public",
]);

export const collectionRoleEnum = pgEnum("collection_role", [
  "owner",
  "editor",
  "viewer",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "open",
  "reviewed_ok",
  "removed",
]);

export const reportTargetEnum = pgEnum("report_target", [
  "station",
  "collection",
  "user",
]);

// ============ USERS ============

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  bio: text("bio"),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============ STATIONS ============

export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  type: stationTypeEnum("type").notNull().default("custom"),
  defaultTimeMinutes: integer("default_time_minutes").notNull().default(7),
  readingTimeMinutes: integer("reading_time_minutes").notNull().default(1),
  scenario: text("scenario"),
  patientBriefing: text("patient_briefing"), // Hidden AI prompt
  hasPatientBriefing: boolean("has_patient_briefing").notNull().default(true),
  aiPatientEnabled: boolean("ai_patient_enabled").notNull().default(true),
  specialty: varchar("specialty", { length: 100 }),
  difficulty: difficultyEnum("difficulty"),
  tags: jsonb("tags").$type<string[]>().default([]),
  customVocabulary: jsonb("custom_vocabulary").$type<string[]>().default([]),
  referenceImageUrl: text("reference_image_url"),
  referenceImageCaption: text("reference_image_caption"),
  forkOf: integer("fork_of").references((): any => stations.id, { onDelete: "set null" }),
  visibility: visibilityEnum("visibility").notNull().default("private"),
  publishedAt: timestamp("published_at"),
  starCount: integer("star_count").notNull().default(0),
  forkCount: integer("fork_count").notNull().default(0),
  practiceCount: integer("practice_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============ SECTIONS ============

export const sections = pgTable("sections", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id")
    .notNull()
    .references(() => stations.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  order: integer("order").notNull().default(0),
  description: text("description"),
  imageUrl: text("image_url"),
  imageCaption: text("image_caption"),
});

// ============ ITEMS ============

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id")
    .notNull()
    .references(() => sections.id, { onDelete: "cascade" }),
  parentItemId: integer("parent_item_id"),
  text: text("text").notNull(),
  isCritical: boolean("is_critical").notNull().default(false),
  points: integer("points").notNull().default(1),
  order: integer("order").notNull().default(0),
  explanation: text("explanation"),
  imageUrl: text("image_url"),
  imageCaption: text("image_caption"),
  videoUrl: text("video_url"),
});

// ============ ITEM MEDIA ============

export const itemMedia = pgTable("item_media", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'image' | 'video'
  url: text("url").notNull(),
  caption: text("caption"),
  order: integer("order").notNull().default(0),
});

// ============ AI COSTS ============

export const aiCosts = pgTable("ai_costs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id"),
  userId: integer("user_id"),
  model: varchar("model", { length: 64 }).notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costEstimateUsd: real("cost_estimate_usd").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============ EXAMINER QUESTIONS ============

// Config shapes (discriminated by questionType):
//   - free_text:       config = null; uses idealAnswer + keyPoints columns
//   - multiple_choice: config = { options: Array<{text, isCorrect}> }
//                      Exactly one isCorrect=true; user taps one option.
//   - multi_select:    config = { options: Array<{text, isCorrect}>, threshold: number }
//                      threshold = minimum # of correct picks for full credit;
//                      partial credit = clamp(correctPicks / threshold, 0, 1)
// image_url is optional on all types (shown above the question).
export interface ExaminerQuestionOption {
  text: string;
  isCorrect: boolean;
}

export type ExaminerQuestionConfig =
  | null
  | { options: ExaminerQuestionOption[] }
  | { options: ExaminerQuestionOption[]; threshold: number };

export const examinerQuestions = pgTable("examiner_questions", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id")
    .notNull()
    .references(() => stations.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  questionType: examinerQuestionTypeEnum("question_type")
    .notNull()
    .default("free_text"),
  idealAnswer: text("ideal_answer"),
  keyPoints: jsonb("key_points").$type<string[]>().default([]),
  config: jsonb("config").$type<ExaminerQuestionConfig>(),
  imageUrl: varchar("image_url", { length: 500 }),
  order: integer("order").notNull().default(0),
});

// ============ COLLECTIONS ============

export const collections = pgTable("collections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  specialty: varchar("specialty", { length: 100 }),
  tags: jsonb("tags").$type<string[]>().default([]),
  visibility: visibilityEnum("visibility").notNull().default("private"),
  publishedAt: timestamp("published_at"),
  starCount: integer("star_count").notNull().default(0),
  forkCount: integer("fork_count").notNull().default(0),
  forkOf: integer("fork_of").references((): AnyPgColumn => collections.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const collectionStations = pgTable("collection_stations", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  stationId: integer("station_id")
    .notNull()
    .references(() => stations.id, { onDelete: "cascade" }),
  order: integer("order").notNull().default(0),
});

// ============ SESSIONS (Practice Records) ============

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stationId: integer("station_id")
    .notNull()
    .references(() => stations.id, { onDelete: "cascade" }),
  mode: sessionModeEnum("mode").notNull().default("self_check"),
  timeLimitSeconds: integer("time_limit_seconds").notNull(),
  timeUsedSeconds: integer("time_used_seconds"),
  totalScore: real("total_score"),
  criticalItemsMissed: boolean("critical_items_missed").default(false),
  transcript: text("transcript"),
  // Back-reference to the template — kept for backward compatibility with
  // rows written before mock_exam_attempts existed. New writes set both
  // this AND mockExamAttemptId.
  mockExamId: integer("mock_exam_id").references(() => mockExams.id, {
    onDelete: "set null",
  }),
  // Associates this station session with a specific run-through of a mock
  // exam so per-attempt composite scores can be read back.
  mockExamAttemptId: integer("mock_exam_attempt_id").references(
    () => mockExamAttempts.id,
    { onDelete: "set null" },
  ),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

// ============ ITEM RESULTS ============

export const itemResults = pgTable("item_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  status: itemStatusEnum("status").notNull(),
  matchedTranscript: text("matched_transcript"),
  timestampSeconds: integer("timestamp_seconds"),
});

// ============ EXAMINER QUESTION RESULTS ============

export const examinerQuestionResults = pgTable("examiner_question_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  questionId: integer("question_id")
    .notNull()
    .references(() => examinerQuestions.id, { onDelete: "cascade" }),
  userAnswerTranscript: text("user_answer_transcript"),
  score: real("score"), // 0.0 to 1.0
  feedback: text("feedback"),
});

// ============ MOCK EXAMS ============

export const mockExamStatusEnum = pgEnum("mock_exam_status", [
  "draft",
  "in_progress",
  "completed",
]);

// Practice mode chosen once at mock exam creation time — all stations in the
// exam run in this mode (mirrors a real OSCE circuit which is one format
// throughout). Existing rows default to `self_check` for backwards compat.
export const mockExamPracticeModeEnum = pgEnum("mock_exam_practice_mode", [
  "self_check",
  "ai_listen",
  "ai_conversation",
]);

export const MOCK_EXAM_PRACTICE_MODES = [
  "self_check",
  "ai_listen",
  "ai_conversation",
] as const;
export type MockExamPracticeMode = (typeof MOCK_EXAM_PRACTICE_MODES)[number];

// `mock_exams` is now a TEMPLATE only (name, stations, mode, pacing). The
// per-run progress fields — `status`, `currentStationIndex`, `startedAt`,
// `completedAt` — are DEPRECATED and no longer read/written by the app.
// They remain in the schema to keep the row shape compatible with the
// database until a follow-up migration drops them cleanly. See iter10 #3
// and migrations/0007_mock_exam_attempts.sql. Progress now lives in
// `mock_exam_attempts`.
export const mockExams = pgTable("mock_exams", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  stationIds: jsonb("station_ids").$type<number[]>().notNull().default([]),
  restSeconds: integer("rest_seconds").notNull().default(120),
  practiceMode: mockExamPracticeModeEnum("practice_mode")
    .notNull()
    .default("self_check"),
  // Deprecated — progress lives on mock_exam_attempts now.
  status: mockExamStatusEnum("status").notNull().default("draft"),
  currentStationIndex: integer("current_station_index").notNull().default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One run-through of a mock exam template. Attempts are monotonically
// numbered per (userId, mockExamId) pair — enforced by a unique index in
// migrations/0007_mock_exam_attempts.sql. Station sessions associate to an
// attempt via `sessions.mockExamAttemptId` so we can read back per-attempt
// composite scores.
export const mockExamAttempts = pgTable("mock_exam_attempts", {
  id: serial("id").primaryKey(),
  mockExamId: integer("mock_exam_id")
    .notNull()
    .references(() => mockExams.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  currentStationIndex: integer("current_station_index").notNull().default(0),
  overallScore: real("overall_score"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ============ COLLECTION MEMBERS ============

export const collectionMembers = pgTable(
  "collection_members",
  {
    id: serial("id").primaryKey(),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: collectionRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqMember: unique().on(t.collectionId, t.userId),
    idxUser: index("idx_collection_members_user").on(t.userId),
  }),
);

// ============ COLLECTION INVITES ============

export const collectionInvites = pgTable("collection_invites", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: collectionRoleEnum("role").notNull(),
  token: text("token").notNull().unique(),
  invitedBy: integer("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: integer("accepted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============ STARS ============

export const stationStars = pgTable(
  "station_stars",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.stationId] }),
  }),
);

export const collectionStars = pgTable(
  "collection_stars",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.collectionId] }),
  }),
);

// ============ PASSWORD RESETS ============

export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  requestedIp: varchar("requested_ip", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============ EMAIL VERIFICATIONS ============

export const emailVerifications = pgTable("email_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(), // SHA-256 digest of the raw token
  expiresAt: timestamp("expires_at").notNull(), // 24 h from creation
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============ REPORTS ============

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  targetType: reportTargetEnum("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  reporterId: integer("reporter_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reason: text("reason").notNull(),
  status: reportStatusEnum("status").notNull().default("open"),
  reviewedBy: integer("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============ RELATIONS ============

export const usersRelations = relations(users, ({ many }) => ({
  stations: many(stations),
  collections: many(collections),
  sessions: many(sessions),
  memberships: many(collectionMembers),
  starredStations: many(stationStars),
  starredCollections: many(collectionStars),
}));

export const stationsRelations = relations(stations, ({ one, many }) => ({
  user: one(users, { fields: [stations.userId], references: [users.id] }),
  sections: many(sections),
  examinerQuestions: many(examinerQuestions),
  sessions: many(sessions),
  stars: many(stationStars),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  station: one(stations, {
    fields: [sections.stationId],
    references: [stations.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  section: one(sections, {
    fields: [items.sectionId],
    references: [sections.id],
  }),
  parentItem: one(items, {
    fields: [items.parentItemId],
    references: [items.id],
    relationName: "parentChild",
  }),
  subItems: many(items, { relationName: "parentChild" }),
  media: many(itemMedia),
}));

export const itemMediaRelations = relations(itemMedia, ({ one }) => ({
  item: one(items, {
    fields: [itemMedia.itemId],
    references: [items.id],
  }),
}));

export const examinerQuestionsRelations = relations(
  examinerQuestions,
  ({ one }) => ({
    station: one(stations, {
      fields: [examinerQuestions.stationId],
      references: [stations.id],
    }),
  })
);

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  user: one(users, {
    fields: [collections.userId],
    references: [users.id],
  }),
  collectionStations: many(collectionStations),
  members: many(collectionMembers),
  invites: many(collectionInvites),
  stars: many(collectionStars),
}));

export const collectionMembersRelations = relations(
  collectionMembers,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionMembers.collectionId],
      references: [collections.id],
    }),
    user: one(users, {
      fields: [collectionMembers.userId],
      references: [users.id],
    }),
  }),
);

export const collectionInvitesRelations = relations(
  collectionInvites,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionInvites.collectionId],
      references: [collections.id],
    }),
    inviter: one(users, {
      fields: [collectionInvites.invitedBy],
      references: [users.id],
    }),
    accepter: one(users, {
      fields: [collectionInvites.acceptedBy],
      references: [users.id],
    }),
  }),
);

export const stationStarsRelations = relations(stationStars, ({ one }) => ({
  user: one(users, {
    fields: [stationStars.userId],
    references: [users.id],
  }),
  station: one(stations, {
    fields: [stationStars.stationId],
    references: [stations.id],
  }),
}));

export const collectionStarsRelations = relations(
  collectionStars,
  ({ one }) => ({
    user: one(users, {
      fields: [collectionStars.userId],
      references: [users.id],
    }),
    collection: one(collections, {
      fields: [collectionStars.collectionId],
      references: [collections.id],
    }),
  }),
);

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, {
    fields: [reports.reporterId],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [reports.reviewedBy],
    references: [users.id],
  }),
}));

export const collectionStationsRelations = relations(
  collectionStations,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionStations.collectionId],
      references: [collections.id],
    }),
    station: one(stations, {
      fields: [collectionStations.stationId],
      references: [stations.id],
    }),
  })
);

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  station: one(stations, {
    fields: [sessions.stationId],
    references: [stations.id],
  }),
  mockExam: one(mockExams, {
    fields: [sessions.mockExamId],
    references: [mockExams.id],
  }),
  mockExamAttempt: one(mockExamAttempts, {
    fields: [sessions.mockExamAttemptId],
    references: [mockExamAttempts.id],
  }),
  itemResults: many(itemResults),
  examinerQuestionResults: many(examinerQuestionResults),
}));

export const mockExamsRelations = relations(mockExams, ({ one, many }) => ({
  user: one(users, { fields: [mockExams.userId], references: [users.id] }),
  sessions: many(sessions),
  attempts: many(mockExamAttempts),
}));

export const mockExamAttemptsRelations = relations(
  mockExamAttempts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [mockExamAttempts.userId],
      references: [users.id],
    }),
    mockExam: one(mockExams, {
      fields: [mockExamAttempts.mockExamId],
      references: [mockExams.id],
    }),
    sessions: many(sessions),
  }),
);

export const itemResultsRelations = relations(itemResults, ({ one }) => ({
  session: one(sessions, {
    fields: [itemResults.sessionId],
    references: [sessions.id],
  }),
  item: one(items, { fields: [itemResults.itemId], references: [items.id] }),
}));

export const examinerQuestionResultsRelations = relations(
  examinerQuestionResults,
  ({ one }) => ({
    session: one(sessions, {
      fields: [examinerQuestionResults.sessionId],
      references: [sessions.id],
    }),
    question: one(examinerQuestions, {
      fields: [examinerQuestionResults.questionId],
      references: [examinerQuestions.id],
    }),
  })
);

// ============ ZOD SCHEMAS ============

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStationSchema = createInsertSchema(stations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSectionSchema = createInsertSchema(sections).omit({
  id: true,
});

export const insertItemSchema = createInsertSchema(items).omit({
  id: true,
});

export const insertExaminerQuestionSchema = createInsertSchema(
  examinerQuestions
).omit({ id: true });

export const insertCollectionSchema = createInsertSchema(collections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  startedAt: true,
});

// ============ TYPES ============

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Station = typeof stations.$inferSelect;
export type InsertStation = z.infer<typeof insertStationSchema>;
export type Section = typeof sections.$inferSelect;
export type Item = typeof items.$inferSelect;
export type ExaminerQuestion = typeof examinerQuestions.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ItemResult = typeof itemResults.$inferSelect;
export type ExaminerQuestionResult =
  typeof examinerQuestionResults.$inferSelect;
export type MockExam = typeof mockExams.$inferSelect;
export type MockExamAttempt = typeof mockExamAttempts.$inferSelect;
export type ItemMedia = typeof itemMedia.$inferSelect;

// ============ COMMUNITY LIBRARY TYPES ============

export type Visibility = (typeof visibilityEnum.enumValues)[number];
export type CollectionRole = (typeof collectionRoleEnum.enumValues)[number];
export type ReportStatus = (typeof reportStatusEnum.enumValues)[number];
export type ReportTarget = (typeof reportTargetEnum.enumValues)[number];

export type CollectionMember = typeof collectionMembers.$inferSelect;
export type CollectionInvite = typeof collectionInvites.$inferSelect;
export type StationStar = typeof stationStars.$inferSelect;
export type CollectionStar = typeof collectionStars.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type EmailVerification = typeof emailVerifications.$inferSelect;

export type Difficulty = "beginner" | "intermediate" | "advanced";

// Composite view types for API responses:
export interface CollectionWithMembership extends Collection {
  role: CollectionRole; // requester's role, or "viewer" if public
  memberCount: number;
  stationCount: number;
  isStarred?: boolean;
}

export interface PublicStationSummary {
  id: number;
  title: string;
  type: StationType;
  specialty: string | null;
  difficulty: Difficulty | null;
  tags: string[];
  starCount: number;
  forkCount: number;
  practiceCount: number;
  publishedAt: string;
  author: { id: number; displayName: string };
  isStarred?: boolean;
}

export interface PublicCollectionSummary {
  id: number;
  title: string;
  description: string | null;
  specialty: string | null;
  tags: string[];
  starCount: number;
  forkCount: number;
  stationCount: number;
  publishedAt: string;
  author: { id: number; displayName: string };
  isStarred?: boolean;
}

export interface AuthorProfile {
  id: number;
  displayName: string;
  bio: string | null;
  memberSince: string;
  publishedStations: PublicStationSummary[];
  publishedCollections: PublicCollectionSummary[];
  totalStars: number;
}

// ============ COMPOSITE TYPES ============

export type ItemWithMedia = Item & {
  media?: ItemMedia[];
};

export type ItemWithSubs = ItemWithMedia & {
  subItems: (ItemWithMedia & { subItems: Item[] })[];
};

export type StationWithDetails = Station & {
  sections: (Section & {
    items: ItemWithSubs[];
  })[];
  examinerQuestions: ExaminerQuestion[];
};

// Validates an image/video URL: only relative /uploads/... paths or http(s) URLs.
// Blocks javascript:, data:, file:, and protocol-relative //evil.com.
export const referenceImageUrlSchema = z
  .string()
  .max(500)
  .refine(
    (v) => {
      if (!v) return true;
      if (v.startsWith("//")) return false;
      if (v.startsWith("/uploads/")) return true;
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be an /uploads/... path or http(s) URL" }
  )
  .nullish();

// Examiner question payload (discriminated by questionType).
// Validates per-type rules so the editor + API reject malformed shapes early.
const examinerOptionSchema = z.object({
  text: z.string().min(1).max(500),
  isCorrect: z.boolean(),
});

export const examinerQuestionPayloadSchema = z
  .object({
    question: z.string().min(1),
    questionType: z.enum(EXAMINER_QUESTION_TYPES).default("free_text"),
    idealAnswer: z.string().nullish(),
    keyPoints: z.array(z.string()).default([]),
    config: z.any().nullish(),
    imageUrl: z.string().max(500).nullish(),
    order: z.number(),
  })
  .superRefine((q, ctx) => {
    if (q.questionType === "free_text") {
      if (!q.idealAnswer || !q.idealAnswer.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Free text questions need an ideal answer",
          path: ["idealAnswer"],
        });
      }
      return;
    }
    const parsed = z
      .object({
        options: z.array(examinerOptionSchema).min(2).max(10),
        threshold: z.number().int().min(1).optional(),
      })
      .safeParse(q.config);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Question needs at least 2 options",
        path: ["config"],
      });
      return;
    }
    const correct = parsed.data.options.filter((o) => o.isCorrect).length;
    if (q.questionType === "multiple_choice" && correct !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Multiple choice needs exactly 1 correct option",
        path: ["config"],
      });
    }
    if (q.questionType === "multi_select") {
      if (correct < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Multi-select needs at least 1 correct option",
          path: ["config"],
        });
      }
      const threshold = parsed.data.threshold ?? correct;
      if (threshold < 1 || threshold > correct) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Threshold must be between 1 and the number of correct options",
          path: ["config", "threshold"],
        });
      }
    }
  });

// Station creation payload (nested)
export const createStationSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(STATION_TYPES),
  hasPatientBriefing: z.boolean().optional(),
  aiPatientEnabled: z.boolean().optional(),
  defaultTimeMinutes: z.number().min(1).max(30).default(7),
  readingTimeMinutes: z.number().min(0).max(5).default(1),
  scenario: z.string().optional(),
  patientBriefing: z.string().optional(),
  referenceImageUrl: referenceImageUrlSchema,
  referenceImageCaption: z.string().max(500).nullish(),
  specialty: z.string().max(100).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  tags: z.array(z.string()).default([]),
  sections: z.array(
    z.object({
      title: z.string().min(1).max(255),
      order: z.number(),
      description: z.string().max(5000).nullish(),
      imageUrl: z.string().max(500).nullish(),
      imageCaption: z.string().max(500).nullish(),
      items: z.array(
        z.object({
          text: z.string().min(1),
          isCritical: z.boolean().default(false),
          points: z.number().default(1),
          order: z.number(),
          explanation: z.string().max(20000).nullish(),
          imageUrl: z.string().max(500).nullish(),
          imageCaption: z.string().max(500).nullish(),
          videoUrl: z.string().max(500).nullish(),
          media: z.array(z.object({
            type: z.enum(["image", "video"]),
            url: z.string().max(500),
            caption: z.string().max(500).nullish(),
            order: z.number(),
          })).default([]),
          subItems: z
            .array(
              z.object({
                text: z.string().min(1),
                isCritical: z.boolean().default(false),
                points: z.number().default(1),
                order: z.number(),
                explanation: z.string().max(20000).nullish(),
                imageUrl: z.string().max(500).nullish(),
                imageCaption: z.string().max(500).nullish(),
                videoUrl: z.string().max(500).nullish(),
                media: z.array(z.object({
                  type: z.enum(["image", "video"]),
                  url: z.string().max(500),
                  caption: z.string().max(500).nullish(),
                  order: z.number(),
                })).default([]),
                subItems: z
                  .array(
                    z.object({
                      text: z.string().min(1),
                      isCritical: z.boolean().default(false),
                      points: z.number().default(1),
                      order: z.number(),
                      explanation: z.string().max(20000).nullish(),
                      imageUrl: z.string().max(500).nullish(),
                      imageCaption: z.string().max(500).nullish(),
                      videoUrl: z.string().max(500).nullish(),
                      media: z.array(z.object({
                        type: z.enum(["image", "video"]),
                        url: z.string().max(500),
                        caption: z.string().max(500).nullish(),
                        order: z.number(),
                      })).default([]),
                    })
                  )
                  .default([]),
              })
            )
            .default([]),
        })
      ),
    })
  ),
  examinerQuestions: z
    .array(examinerQuestionPayloadSchema)
    .default([]),
});

export type CreateStationPayload = z.infer<typeof createStationSchema>;

// ============ STATION TYPE SMART DEFAULTS ============

export interface StationTypeDefaults {
  defaultTimeMinutes: number;
  hasPatientBriefing: boolean;
  aiPatientEnabled: boolean;
  patientBriefing: string;
}

export function getStationTypeDefaults(type: StationType): StationTypeDefaults {
  switch (type) {
    case "history_taking":
      return {
        defaultTimeMinutes: 8,
        hasPatientBriefing: true,
        aiPatientEnabled: true,
        patientBriefing: "",
      };
    case "physical_exam":
      return {
        defaultTimeMinutes: 7,
        hasPatientBriefing: false,
        aiPatientEnabled: false,
        patientBriefing: "",
      };
    case "communication":
      return {
        defaultTimeMinutes: 10,
        hasPatientBriefing: true,
        aiPatientEnabled: true,
        patientBriefing: "",
      };
    case "image_id":
      return {
        defaultTimeMinutes: 5,
        hasPatientBriefing: false,
        aiPatientEnabled: false,
        patientBriefing: "",
      };
    case "qa":
      return {
        defaultTimeMinutes: 5,
        hasPatientBriefing: false,
        aiPatientEnabled: false,
        patientBriefing: "",
      };
    case "custom":
    default:
      return {
        defaultTimeMinutes: 7,
        hasPatientBriefing: false,
        aiPatientEnabled: false,
        patientBriefing: "",
      };
  }
}
