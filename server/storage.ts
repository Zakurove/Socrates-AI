import { eq, and, or, desc, asc, sql, inArray, ilike, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "./db.js";
import {
  users,
  stations,
  sections,
  items,
  itemMedia,
  examinerQuestions,
  collections,
  collectionStations,
  collectionMembers,
  collectionInvites,
  passwordResets,
  emailVerifications,
  stationStars,
  collectionStars,
  reports,
  sessions,
  itemResults,
  examinerQuestionResults,
  type User,
  type InsertUser,
  type Station,
  type Section,
  type Item,
  type ItemMedia,
  type ExaminerQuestion,
  type Collection,
  type CollectionMember,
  type CollectionInvite,
  type CollectionRole,
  type CollectionWithMembership,
  type PublicStationSummary,
  type PublicCollectionSummary,
  type AuthorProfile,
  type Report,
  type ReportStatus,
  type ReportTarget,
  type Session,
  type ItemResult,
  type ExaminerQuestionResult,
  type StationWithDetails,
  type CreateStationPayload,
} from "../shared/schema.js";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(
    id: number,
    data: Partial<Pick<User, "displayName" | "password" | "bio">>,
  ): Promise<User | undefined>;

  // Password resets
  createPasswordReset(data: {
    userId: number;
    token: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<void>;
  getPasswordResetByToken(
    token: string,
  ): Promise<
    | {
        id: number;
        userId: number;
        token: string;
        expiresAt: Date;
        usedAt: Date | null;
      }
    | undefined
  >;
  markPasswordResetUsed(id: number): Promise<void>;
  invalidateOtherPasswordResets(
    userId: number,
    keepId: number,
  ): Promise<void>;

  // Email verifications
  createEmailVerification(data: {
    userId: number;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
  getEmailVerificationByToken(token: string): Promise<
    | {
        id: number;
        userId: number;
        token: string;
        expiresAt: Date;
        usedAt: Date | null;
      }
    | undefined
  >;
  markEmailVerificationUsed(id: number): Promise<void>;
  invalidateOtherEmailVerifications(userId: number, keepId: number): Promise<void>;
  markEmailVerified(userId: number): Promise<void>;

  // Stations
  getStations(userId: number): Promise<Station[]>;
  getStation(id: number): Promise<StationWithDetails | undefined>;
  createStation(
    userId: number,
    payload: CreateStationPayload,
  ): Promise<StationWithDetails>;
  updateStation(
    id: number,
    data: Partial<Station> & {
      sections?: CreateStationPayload["sections"];
      examinerQuestions?: CreateStationPayload["examinerQuestions"];
    },
  ): Promise<StationWithDetails | undefined>;
  deleteStation(id: number): Promise<void>;

  // Collections
  getCollections(userId: number): Promise<Collection[]>;
  getCollection(
    id: number,
  ): Promise<(Collection & { stations: Station[] }) | undefined>;
  createCollection(data: {
    userId: number;
    title: string;
    description?: string;
    specialty?: string;
    tags?: string[];
  }): Promise<Collection>;
  updateCollection(
    id: number,
    data: Partial<Collection>,
  ): Promise<Collection | undefined>;
  deleteCollection(id: number): Promise<void>;
  addStationToCollection(
    collectionId: number,
    stationId: number,
    order?: number,
  ): Promise<void>;
  removeStationFromCollection(
    collectionId: number,
    stationId: number,
  ): Promise<void>;

  // Sessions
  getSessions(
    userId: number,
    stationId?: number,
  ): Promise<
    (Session & {
      station: { id: number; title: string; type: Station["type"] };
    })[]
  >;
  getSession(
    id: number,
  ): Promise<
    | (Session & {
        station: { id: number; title: string; type: Station["type"] };
        itemResults: (ItemResult & {
          item: {
            id: number;
            text: string;
            isCritical: boolean;
            sectionId: number;
            parentItemId: number | null;
            section: { title: string };
          };
        })[];
        examinerQuestionResults: (ExaminerQuestionResult & {
          question: { question: string; idealAnswer: string };
        })[];
      })
    | undefined
  >;
  createSession(data: {
    userId: number;
    stationId: number;
    mode: "self_check" | "ai_history" | "ai_observer" | "ai_communication";
    timeLimitSeconds: number;
    mockExamId?: number;
    mockExamAttemptId?: number;
  }): Promise<Session>;
  updateSession(
    id: number,
    data: Partial<Session>,
  ): Promise<Session | undefined>;
  finalizeSession(
    id: number,
    data: Partial<Session>,
  ): Promise<{ session: Session | undefined; wasFirstFinalize: boolean }>;

  // Item Results
  createItemResult(
    data: Omit<ItemResult, "id">,
  ): Promise<ItemResult>;
  createItemResults(
    rows: Omit<ItemResult, "id">[],
  ): Promise<ItemResult[]>;
  getItemResultsBySession(sessionId: number): Promise<ItemResult[]>;

  // Examiner Question Results
  createExaminerQuestionResult(
    data: Omit<ExaminerQuestionResult, "id">,
  ): Promise<ExaminerQuestionResult>;
  createExaminerQuestionResults(
    rows: Omit<ExaminerQuestionResult, "id">[],
  ): Promise<ExaminerQuestionResult[]>;
  getExaminerQuestionResultsBySession(
    sessionId: number,
  ): Promise<ExaminerQuestionResult[]>;

  // ─── Community Library ─────────────────────────────────

  // Collection membership
  getUserCollections(userId: number): Promise<CollectionWithMembership[]>;
  getCollectionMembership(
    collectionId: number,
    userId: number,
  ): Promise<CollectionMember | undefined>;
  listCollectionMembers(collectionId: number): Promise<
    Array<{
      userId: number;
      displayName: string;
      email: string;
      role: CollectionRole;
      createdAt: Date;
    }>
  >;
  addCollectionMember(
    collectionId: number,
    userId: number,
    role: CollectionRole,
  ): Promise<CollectionMember>;
  removeCollectionMember(
    collectionId: number,
    userId: number,
  ): Promise<void>;
  updateMemberRole(
    collectionId: number,
    userId: number,
    role: CollectionRole,
  ): Promise<CollectionMember | undefined>;

  // Invites
  createInvite(data: {
    collectionId: number;
    email: string;
    role: CollectionRole;
    invitedBy: number;
  }): Promise<CollectionInvite>;
  getInviteByToken(
    token: string,
  ): Promise<
    | (CollectionInvite & {
        collection: { id: number; title: string };
      })
    | undefined
  >;
  getInvitesForCollection(
    collectionId: number,
  ): Promise<CollectionInvite[]>;
  acceptInvite(
    token: string,
    userId: number,
  ): Promise<{ invite: CollectionInvite; member: CollectionMember } | undefined>;
  cancelInvite(inviteId: number): Promise<void>;

  // Publish
  publishStation(stationId: number): Promise<Station | undefined>;
  unpublishStation(stationId: number): Promise<Station | undefined>;
  publishCollection(collectionId: number): Promise<Collection | undefined>;
  unpublishCollection(collectionId: number): Promise<Collection | undefined>;

  // Public library browse + detail
  listPublicStations(filters: {
    q?: string;
    type?: string;
    specialty?: string;
    difficulty?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: PublicStationSummary[]; total: number }>;
  listPublicCollections(filters: {
    q?: string;
    specialty?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: PublicCollectionSummary[]; total: number }>;
  getPublicStation(
    id: number,
  ): Promise<
    | (StationWithDetails & {
        author: { id: number; displayName: string };
      })
    | null
  >;
  getPublicCollection(id: number): Promise<
    | (Collection & {
        stations: PublicStationSummary[];
        author: { id: number; displayName: string };
      })
    | null
  >;

  // Fork
  forkStation(
    sourceId: number,
    newOwnerId: number,
  ): Promise<StationWithDetails>;
  forkCollection(
    sourceId: number,
    newOwnerId: number,
  ): Promise<Collection>;

  // Stars
  starStation(userId: number, stationId: number): Promise<void>;
  unstarStation(userId: number, stationId: number): Promise<void>;
  starCollection(userId: number, collectionId: number): Promise<void>;
  unstarCollection(userId: number, collectionId: number): Promise<void>;
  isStationStarredByUser(
    userId: number,
    stationId: number,
  ): Promise<boolean>;
  isCollectionStarredByUser(
    userId: number,
    collectionId: number,
  ): Promise<boolean>;

  // Practice count
  incrementPracticeCount(stationId: number): Promise<void>;

  // Reports / moderation
  createReport(data: {
    targetType: ReportTarget;
    targetId: number;
    reporterId: number | null;
    reason: string;
  }): Promise<Report>;
  listReports(status?: ReportStatus): Promise<
    Array<Report & { targetPreview: { title: string | null } }>
  >;
  updateReport(
    id: number,
    data: { status?: ReportStatus; reviewedBy?: number; notes?: string },
  ): Promise<Report | undefined>;

  // Public author profile
  getUserPublicProfile(id: number): Promise<AuthorProfile | null>;
}

class DatabaseStorage implements IStorage {
  // ─── Users ──────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({ ...data, email: data.email.toLowerCase() })
      .returning();
    return user;
  }

  async updateUser(
    id: number,
    data: Partial<Pick<User, "displayName" | "password" | "bio">>,
  ): Promise<User | undefined> {
    // Allow-list: only these keys may flow through the generic updater.
    // Sensitive columns (isAdmin, email, id, createdAt) must NEVER be writable
    // from route code via this method — admins are promoted by explicit SQL.
    const allowed: Partial<Pick<User, "displayName" | "password" | "bio">> = {};
    if (data.displayName !== undefined) allowed.displayName = data.displayName;
    if (data.password !== undefined) allowed.password = data.password;
    if (data.bio !== undefined) allowed.bio = data.bio;
    if (Object.keys(allowed).length === 0) return undefined;
    const [user] = await db
      .update(users)
      .set({ ...allowed, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  // ─── Password resets ────────────────────────────────────

  async createPasswordReset(data: {
    userId: number;
    token: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<void> {
    await db.insert(passwordResets).values({
      userId: data.userId,
      token: data.token,
      expiresAt: data.expiresAt,
      requestedIp: data.requestedIp,
    });
  }

  async getPasswordResetByToken(
    token: string,
  ): Promise<
    | {
        id: number;
        userId: number;
        token: string;
        expiresAt: Date;
        usedAt: Date | null;
      }
    | undefined
  > {
    const [row] = await db
      .select({
        id: passwordResets.id,
        userId: passwordResets.userId,
        token: passwordResets.token,
        expiresAt: passwordResets.expiresAt,
        usedAt: passwordResets.usedAt,
      })
      .from(passwordResets)
      .where(eq(passwordResets.token, token))
      .limit(1);
    return row;
  }

  async markPasswordResetUsed(id: number): Promise<void> {
    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, id));
  }

  async invalidateOtherPasswordResets(
    userId: number,
    keepId: number,
  ): Promise<void> {
    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResets.userId, userId),
          sql`${passwordResets.id} <> ${keepId}`,
          isNull(passwordResets.usedAt),
        ),
      );
  }

  // ─── Email verifications ────────────────────────────────

  async createEmailVerification(data: {
    userId: number;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(emailVerifications).values({
      userId: data.userId,
      token: data.token,
      expiresAt: data.expiresAt,
    });
  }

  async getEmailVerificationByToken(token: string): Promise<
    | {
        id: number;
        userId: number;
        token: string;
        expiresAt: Date;
        usedAt: Date | null;
      }
    | undefined
  > {
    const [row] = await db
      .select({
        id: emailVerifications.id,
        userId: emailVerifications.userId,
        token: emailVerifications.token,
        expiresAt: emailVerifications.expiresAt,
        usedAt: emailVerifications.usedAt,
      })
      .from(emailVerifications)
      .where(eq(emailVerifications.token, token))
      .limit(1);
    return row;
  }

  async markEmailVerificationUsed(id: number): Promise<void> {
    await db
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(eq(emailVerifications.id, id));
  }

  async invalidateOtherEmailVerifications(
    userId: number,
    keepId: number,
  ): Promise<void> {
    await db
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerifications.userId, userId),
          sql`${emailVerifications.id} <> ${keepId}`,
          isNull(emailVerifications.usedAt),
        ),
      );
  }

  async markEmailVerified(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // ─── Stations ───────────────────────────────────────────

  async getStations(userId: number): Promise<Station[]> {
    return db
      .select()
      .from(stations)
      .where(eq(stations.userId, userId))
      .orderBy(desc(stations.updatedAt)) as unknown as Promise<Station[]>;
  }

  async getStation(id: number): Promise<StationWithDetails | undefined> {
    const station = await db.query.stations.findFirst({
      where: eq(stations.id, id),
      with: {
        sections: {
          orderBy: [asc(sections.order)],
          with: {
            items: {
              where: (itemsTable: any, { isNull }: any) =>
                isNull(itemsTable.parentItemId),
              orderBy: [asc(items.order)],
              with: {
                media: {
                  orderBy: [asc(itemMedia.order)],
                },
                subItems: {
                  orderBy: [asc(items.order)],
                  with: {
                    media: {
                      orderBy: [asc(itemMedia.order)],
                    },
                    subItems: {
                      orderBy: [asc(items.order)],
                    },
                  },
                },
              },
            },
          },
        },
        examinerQuestions: {
          orderBy: [asc(examinerQuestions.order)],
        },
      },
    });

    return station as StationWithDetails | undefined;
  }

  async createStation(
    userId: number,
    payload: CreateStationPayload,
  ): Promise<StationWithDetails> {
    return await db.transaction(async (tx) => {
      // 1. Create station
      const stationRows = (await tx
        .insert(stations)
        .values({
          userId,
          title: payload.title,
          type: payload.type,
          defaultTimeMinutes: payload.defaultTimeMinutes,
          readingTimeMinutes: payload.readingTimeMinutes,
          scenario: payload.scenario,
          patientBriefing: payload.patientBriefing,
          referenceImageUrl: (payload as any).referenceImageUrl ?? null,
          referenceImageCaption: (payload as any).referenceImageCaption ?? null,
          hasPatientBriefing: (payload as any).hasPatientBriefing,
          aiPatientEnabled: (payload as any).aiPatientEnabled,
          specialty: payload.specialty,
          difficulty: payload.difficulty,
          tags: payload.tags,
        })
        .returning()) as Station[];
      const station = stationRows[0];

      // Helper: save item_media rows and backfill legacy columns
      const saveItemMedia = async (
        txRef: typeof tx,
        itemId: number,
        mediaList: Array<{ type: string; url: string; caption?: string | null; order: number }>,
      ) => {
        for (const m of mediaList) {
          await txRef.insert(itemMedia).values({
            itemId,
            type: m.type,
            url: m.url,
            caption: m.caption ?? null,
            order: m.order,
          });
        }
      };

      // 2. Create sections + items + sub-items
      const sectionsWithItems = [];
      for (const sectionPayload of payload.sections) {
        const sectionRows = (await tx
          .insert(sections)
          .values({
            stationId: station.id,
            title: sectionPayload.title,
            order: sectionPayload.order,
            description: (sectionPayload as any).description ?? null,
            imageUrl: (sectionPayload as any).imageUrl ?? null,
            imageCaption: (sectionPayload as any).imageCaption ?? null,
          })
          .returning()) as Section[];
        const section = sectionRows[0];

        const itemsWithSubs = [];
        for (const itemPayload of sectionPayload.items) {
          // Backward compat: write first image/video from media to legacy columns
          const media = (itemPayload as any).media ?? [];
          const firstImage = media.find((m: any) => m.type === "image");
          const firstVideo = media.find((m: any) => m.type === "video");
          const legacyImageUrl = itemPayload.imageUrl ?? firstImage?.url ?? null;
          const legacyImageCaption = itemPayload.imageCaption ?? firstImage?.caption ?? null;
          const legacyVideoUrl = itemPayload.videoUrl ?? firstVideo?.url ?? null;

          const itemRows = (await tx
            .insert(items)
            .values({
              sectionId: section.id,
              text: itemPayload.text,
              isCritical: itemPayload.isCritical,
              points: itemPayload.points,
              order: itemPayload.order,
              explanation: itemPayload.explanation ?? null,
              imageUrl: legacyImageUrl,
              imageCaption: legacyImageCaption,
              videoUrl: legacyVideoUrl,
            })
            .returning()) as Item[];
          const item = itemRows[0];

          // Save item media rows
          if (media.length > 0) {
            await saveItemMedia(tx, item.id, media);
          }

          const createdSubItems: (Item & { subItems: Item[] })[] = [];
          for (const subPayload of itemPayload.subItems) {
            const subMedia = (subPayload as any).media ?? [];
            const subFirstImage = subMedia.find((m: any) => m.type === "image");
            const subFirstVideo = subMedia.find((m: any) => m.type === "video");
            const subLegacyImageUrl = subPayload.imageUrl ?? subFirstImage?.url ?? null;
            const subLegacyImageCaption = subPayload.imageCaption ?? subFirstImage?.caption ?? null;
            const subLegacyVideoUrl = subPayload.videoUrl ?? subFirstVideo?.url ?? null;

            const subRows = (await tx
              .insert(items)
              .values({
                sectionId: section.id,
                parentItemId: item.id,
                text: subPayload.text,
                isCritical: subPayload.isCritical,
                points: subPayload.points,
                order: subPayload.order,
                explanation: subPayload.explanation ?? null,
                imageUrl: subLegacyImageUrl,
                imageCaption: subLegacyImageCaption,
                videoUrl: subLegacyVideoUrl,
              })
              .returning()) as Item[];
            const subItem = subRows[0];

            // Save sub-item media rows
            if (subMedia.length > 0) {
              await saveItemMedia(tx, subItem.id, subMedia);
            }

            const createdSubSubItems: Item[] = [];
            for (const subSubPayload of subPayload.subItems) {
              const subSubRows = (await tx
                .insert(items)
                .values({
                  sectionId: section.id,
                  parentItemId: subItem.id,
                  text: subSubPayload.text,
                  isCritical: subSubPayload.isCritical,
                  points: subSubPayload.points,
                  order: subSubPayload.order,
                  explanation: subSubPayload.explanation ?? null,
                  imageUrl: subSubPayload.imageUrl ?? null,
                  imageCaption: subSubPayload.imageCaption ?? null,
                  videoUrl: subSubPayload.videoUrl ?? null,
                })
                .returning()) as Item[];
              createdSubSubItems.push(subSubRows[0]);
            }

            createdSubItems.push({ ...subItem, subItems: createdSubSubItems });
          }

          itemsWithSubs.push({ ...item, subItems: createdSubItems });
        }

        sectionsWithItems.push({ ...section, items: itemsWithSubs });
      }

      // 3. Create examiner questions
      const eqRows: ExaminerQuestion[] = [];
      for (const eqPayload of payload.examinerQuestions) {
        const eqResultRows = (await tx
          .insert(examinerQuestions)
          .values({
            stationId: station.id,
            question: eqPayload.question,
            questionType: eqPayload.questionType ?? "free_text",
            idealAnswer: eqPayload.idealAnswer ?? null,
            keyPoints: eqPayload.keyPoints,
            config: (eqPayload.config ?? null) as any,
            imageUrl: eqPayload.imageUrl ?? null,
            order: eqPayload.order,
          })
          .returning()) as ExaminerQuestion[];
        eqRows.push(eqResultRows[0]);
      }

      return {
        ...station,
        sections: sectionsWithItems,
        examinerQuestions: eqRows,
      } as StationWithDetails;
    });
  }

  async updateStation(
    id: number,
    data: Partial<Station> & {
      sections?: CreateStationPayload["sections"];
      examinerQuestions?: CreateStationPayload["examinerQuestions"];
    },
  ): Promise<StationWithDetails | undefined> {
    const {
      sections: sectionsPayload,
      examinerQuestions: eqPayload,
      ...flatRaw
    } = data;

    // Drop nested/invalid keys; only keep Station columns.
    const flat: Partial<Station> = {};
    const allowed: (keyof Station)[] = [
      "title",
      "type",
      "defaultTimeMinutes",
      "readingTimeMinutes",
      "scenario",
      "patientBriefing",
      "hasPatientBriefing",
      "aiPatientEnabled",
      "specialty",
      "difficulty",
      "tags",
      "customVocabulary",
      "referenceImageUrl",
      "referenceImageCaption",
    ];
    for (const k of allowed) {
      if (k in flatRaw && (flatRaw as any)[k] !== undefined) {
        (flat as any)[k] = (flatRaw as any)[k];
      }
    }

    await db.transaction(async (tx) => {
      if (Object.keys(flat).length > 0) {
        await tx
          .update(stations)
          .set({ ...flat, updatedAt: new Date() })
          .where(eq(stations.id, id));
      } else {
        await tx
          .update(stations)
          .set({ updatedAt: new Date() })
          .where(eq(stations.id, id));
      }

      if (sectionsPayload) {
        // Delete existing sections — cascade removes items (and item_media via cascade).
        await tx.delete(sections).where(eq(sections.stationId, id));

        for (const sectionPayload of sectionsPayload) {
          const sectionRows = (await tx
            .insert(sections)
            .values({
              stationId: id,
              title: sectionPayload.title,
              order: sectionPayload.order,
              description: (sectionPayload as any).description ?? null,
              imageUrl: (sectionPayload as any).imageUrl ?? null,
              imageCaption: (sectionPayload as any).imageCaption ?? null,
            })
            .returning()) as Section[];
          const section = sectionRows[0];

          for (const itemPayload of sectionPayload.items) {
            const media = (itemPayload as any).media ?? [];
            const firstImage = media.find((m: any) => m.type === "image");
            const firstVideo = media.find((m: any) => m.type === "video");
            const legacyImageUrl = itemPayload.imageUrl ?? firstImage?.url ?? null;
            const legacyImageCaption = itemPayload.imageCaption ?? firstImage?.caption ?? null;
            const legacyVideoUrl = itemPayload.videoUrl ?? firstVideo?.url ?? null;

            const itemRows = (await tx
              .insert(items)
              .values({
                sectionId: section.id,
                text: itemPayload.text,
                isCritical: itemPayload.isCritical,
                points: itemPayload.points,
                order: itemPayload.order,
                explanation: itemPayload.explanation ?? null,
                imageUrl: legacyImageUrl,
                imageCaption: legacyImageCaption,
                videoUrl: legacyVideoUrl,
              })
              .returning()) as Item[];
            const item = itemRows[0];

            // Save item media rows
            if (media.length > 0) {
              for (const m of media) {
                await tx.insert(itemMedia).values({
                  itemId: item.id,
                  type: m.type,
                  url: m.url,
                  caption: m.caption ?? null,
                  order: m.order,
                });
              }
            }

            for (const subPayload of itemPayload.subItems) {
              const subMedia = (subPayload as any).media ?? [];
              const subFirstImage = subMedia.find((m: any) => m.type === "image");
              const subFirstVideo = subMedia.find((m: any) => m.type === "video");
              const subLegacyImageUrl = subPayload.imageUrl ?? subFirstImage?.url ?? null;
              const subLegacyImageCaption = subPayload.imageCaption ?? subFirstImage?.caption ?? null;
              const subLegacyVideoUrl = subPayload.videoUrl ?? subFirstVideo?.url ?? null;

              const subRows = (await tx.insert(items).values({
                sectionId: section.id,
                parentItemId: item.id,
                text: subPayload.text,
                isCritical: subPayload.isCritical,
                points: subPayload.points,
                order: subPayload.order,
                explanation: subPayload.explanation ?? null,
                imageUrl: subLegacyImageUrl,
                imageCaption: subLegacyImageCaption,
                videoUrl: subLegacyVideoUrl,
              }).returning()) as Item[];
              const subItem = subRows[0];

              // Save sub-item media rows
              if (subMedia.length > 0) {
                for (const m of subMedia) {
                  await tx.insert(itemMedia).values({
                    itemId: subItem.id,
                    type: m.type,
                    url: m.url,
                    caption: m.caption ?? null,
                    order: m.order,
                  });
                }
              }

              for (const subSubPayload of subPayload.subItems) {
                const ssMedia = (subSubPayload as any).media ?? [];
                const ssFirstImage = ssMedia.find((m: any) => m.type === "image");
                const ssFirstVideo = ssMedia.find((m: any) => m.type === "video");

                await tx.insert(items).values({
                  sectionId: section.id,
                  parentItemId: subItem.id,
                  text: subSubPayload.text,
                  isCritical: subSubPayload.isCritical,
                  points: subSubPayload.points,
                  order: subSubPayload.order,
                  explanation: subSubPayload.explanation ?? null,
                  imageUrl: subSubPayload.imageUrl ?? ssFirstImage?.url ?? null,
                  imageCaption: subSubPayload.imageCaption ?? ssFirstImage?.caption ?? null,
                  videoUrl: subSubPayload.videoUrl ?? ssFirstVideo?.url ?? null,
                });
              }
            }
          }
        }
      }

      if (eqPayload) {
        await tx
          .delete(examinerQuestions)
          .where(eq(examinerQuestions.stationId, id));

        for (const q of eqPayload) {
          await tx.insert(examinerQuestions).values({
            stationId: id,
            question: q.question,
            questionType: q.questionType ?? "free_text",
            idealAnswer: q.idealAnswer ?? null,
            keyPoints: q.keyPoints,
            config: (q.config ?? null) as any,
            imageUrl: q.imageUrl ?? null,
            order: q.order,
          });
        }
      }
    });

    return this.getStation(id);
  }

  async deleteStation(id: number): Promise<void> {
    await db.delete(stations).where(eq(stations.id, id));
  }

  // ─── Collections ────────────────────────────────────────

  async getCollections(userId: number): Promise<Collection[]> {
    return db
      .select()
      .from(collections)
      .where(eq(collections.userId, userId))
      .orderBy(desc(collections.updatedAt));
  }

  async getCollection(
    id: number,
  ): Promise<(Collection & { stations: Station[] }) | undefined> {
    const collection = await db.query.collections.findFirst({
      where: eq(collections.id, id),
      with: {
        collectionStations: {
          orderBy: [asc(collectionStations.order)],
          with: {
            station: true,
          },
        },
      },
    });

    if (!collection) return undefined;

    return {
      ...collection,
      stations: (collection.collectionStations as any[]).map(
        (cs) => cs.station,
      ),
    } as Collection & { stations: Station[] };
  }

  async createCollection(data: {
    userId: number;
    title: string;
    description?: string;
    specialty?: string;
    tags?: string[];
  }): Promise<Collection> {
    const [collection] = await db
      .insert(collections)
      .values(data)
      .returning();
    return collection;
  }

  async updateCollection(
    id: number,
    data: Partial<Collection>,
  ): Promise<Collection | undefined> {
    const [updated] = await db
      .update(collections)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(collections.id, id))
      .returning();
    return updated;
  }

  async deleteCollection(id: number): Promise<void> {
    await db.delete(collections).where(eq(collections.id, id));
  }

  async addStationToCollection(
    collectionId: number,
    stationId: number,
    order?: number,
  ): Promise<void> {
    await db.insert(collectionStations).values({
      collectionId,
      stationId,
      order: order ?? 0,
    });
  }

  async removeStationFromCollection(
    collectionId: number,
    stationId: number,
  ): Promise<void> {
    await db
      .delete(collectionStations)
      .where(
        and(
          eq(collectionStations.collectionId, collectionId),
          eq(collectionStations.stationId, stationId),
        ),
      );
  }

  // ─── Sessions ───────────────────────────────────────────

  async getSessions(
    userId: number,
    stationId?: number,
  ): Promise<
    (Session & {
      station: { id: number; title: string; type: Station["type"] };
    })[]
  > {
    const conditions = [eq(sessions.userId, userId)];
    if (stationId) {
      conditions.push(eq(sessions.stationId, stationId));
    }
    const rows = await db.query.sessions.findMany({
      where: and(...conditions),
      orderBy: [desc(sessions.startedAt)],
      with: {
        station: {
          columns: { id: true, title: true, type: true },
        },
      },
    });
    return rows as unknown as (Session & {
      station: { id: number; title: string; type: Station["type"] };
    })[];
  }

  async getSession(
    id: number,
  ): Promise<
    | (Session & {
        station: { id: number; title: string; type: Station["type"] };
        itemResults: (ItemResult & {
          item: {
            id: number;
            text: string;
            isCritical: boolean;
            sectionId: number;
            parentItemId: number | null;
            section: { title: string };
          };
        })[];
        examinerQuestionResults: (ExaminerQuestionResult & {
          question: { question: string; idealAnswer: string };
        })[];
      })
    | undefined
  > {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, id),
      with: {
        station: {
          columns: { id: true, title: true, type: true },
        },
        itemResults: {
          with: {
            item: {
              columns: {
                id: true,
                text: true,
                isCritical: true,
                sectionId: true,
                parentItemId: true,
              },
              with: {
                section: {
                  columns: { title: true },
                },
              },
            },
          },
        },
        examinerQuestionResults: {
          with: {
            question: {
              columns: { question: true, idealAnswer: true },
            },
          },
        },
      },
    });
    return session as any;
  }

  async createSession(data: {
    userId: number;
    stationId: number;
    mode: "self_check" | "ai_history" | "ai_observer" | "ai_communication";
    timeLimitSeconds: number;
    mockExamId?: number;
    mockExamAttemptId?: number;
  }): Promise<Session> {
    const [session] = await db.insert(sessions).values(data).returning();
    return session;
  }

  async updateSession(
    id: number,
    data: Partial<Session>,
  ): Promise<Session | undefined> {
    const [updated] = await db
      .update(sessions)
      .set(data)
      .where(eq(sessions.id, id))
      .returning();
    return updated;
  }

  /**
   * Atomically finalize a session and bump practiceCount if the station is
   * public. Uses a conditional UPDATE (`WHERE ended_at IS NULL`) so concurrent
   * double-submits can only transition the session once, preventing inflated
   * practice counters.
   *
   * Returns `{ session, wasFirstFinalize }`. Only when `wasFirstFinalize` is
   * true should callers treat the operation as a real completion.
   */
  async finalizeSession(
    id: number,
    data: Partial<Session>,
  ): Promise<{ session: Session | undefined; wasFirstFinalize: boolean }> {
    return db.transaction(async (tx) => {
      const [finalized] = await tx
        .update(sessions)
        .set(data)
        .where(and(eq(sessions.id, id), sql`${sessions.endedAt} IS NULL`))
        .returning();

      if (!finalized) {
        const existing = await tx.query.sessions.findFirst({
          where: eq(sessions.id, id),
        });
        return { session: existing, wasFirstFinalize: false };
      }

      const station = await tx.query.stations.findFirst({
        where: eq(stations.id, finalized.stationId),
      });
      if (station?.visibility === "public") {
        await tx
          .update(stations)
          .set({ practiceCount: sql`${stations.practiceCount} + 1` })
          .where(eq(stations.id, finalized.stationId));
      }

      return { session: finalized, wasFirstFinalize: true };
    });
  }

  // ─── Item Results ───────────────────────────────────────

  async createItemResult(
    data: Omit<ItemResult, "id">,
  ): Promise<ItemResult> {
    const [result] = await db.insert(itemResults).values(data).returning();
    return result;
  }

  /** Atomic batch insert — single INSERT, all rows or none. */
  async createItemResults(
    rows: Omit<ItemResult, "id">[],
  ): Promise<ItemResult[]> {
    if (rows.length === 0) return [];
    return db.insert(itemResults).values(rows).returning();
  }

  async getItemResultsBySession(sessionId: number): Promise<ItemResult[]> {
    return db
      .select()
      .from(itemResults)
      .where(eq(itemResults.sessionId, sessionId));
  }

  // ─── Examiner Question Results ──────────────────────────

  async createExaminerQuestionResult(
    data: Omit<ExaminerQuestionResult, "id">,
  ): Promise<ExaminerQuestionResult> {
    const [result] = await db
      .insert(examinerQuestionResults)
      .values(data)
      .returning();
    return result;
  }

  /** Atomic batch insert — single INSERT, all rows or none. */
  async createExaminerQuestionResults(
    rows: Omit<ExaminerQuestionResult, "id">[],
  ): Promise<ExaminerQuestionResult[]> {
    if (rows.length === 0) return [];
    return db.insert(examinerQuestionResults).values(rows).returning();
  }

  async getExaminerQuestionResultsBySession(
    sessionId: number,
  ): Promise<ExaminerQuestionResult[]> {
    return db
      .select()
      .from(examinerQuestionResults)
      .where(eq(examinerQuestionResults.sessionId, sessionId));
  }

  // ─── Community Library ──────────────────────────────────

  // Collections the user owns OR is a member of, plus role + aggregate counts.
  async getUserCollections(
    userId: number,
  ): Promise<CollectionWithMembership[]> {
    // Collections where user is owner or member
    const rows = await db
      .select({
        collection: collections,
        role: collectionMembers.role,
      })
      .from(collections)
      .innerJoin(
        collectionMembers,
        eq(collectionMembers.collectionId, collections.id),
      )
      .where(eq(collectionMembers.userId, userId))
      .orderBy(desc(collections.updatedAt));

    if (rows.length === 0) return [];

    const collectionIds = rows.map((r) => r.collection.id);

    // Member counts
    const memberCountRows = await db
      .select({
        collectionId: collectionMembers.collectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(collectionMembers)
      .where(inArray(collectionMembers.collectionId, collectionIds))
      .groupBy(collectionMembers.collectionId);

    // Station counts
    const stationCountRows = await db
      .select({
        collectionId: collectionStations.collectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(collectionStations)
      .where(inArray(collectionStations.collectionId, collectionIds))
      .groupBy(collectionStations.collectionId);

    const memberCountMap = new Map<number, number>();
    for (const r of memberCountRows) memberCountMap.set(r.collectionId, r.count);
    const stationCountMap = new Map<number, number>();
    for (const r of stationCountRows) stationCountMap.set(r.collectionId, r.count);

    return rows.map(
      (r): CollectionWithMembership => ({
        ...r.collection,
        role: r.role as CollectionRole,
        memberCount: memberCountMap.get(r.collection.id) ?? 0,
        stationCount: stationCountMap.get(r.collection.id) ?? 0,
      }),
    );
  }

  async getCollectionMembership(
    collectionId: number,
    userId: number,
  ): Promise<CollectionMember | undefined> {
    const [row] = await db
      .select()
      .from(collectionMembers)
      .where(
        and(
          eq(collectionMembers.collectionId, collectionId),
          eq(collectionMembers.userId, userId),
        ),
      );
    return row;
  }

  async listCollectionMembers(collectionId: number): Promise<
    Array<{
      userId: number;
      displayName: string;
      email: string;
      role: CollectionRole;
      createdAt: Date;
    }>
  > {
    const rows = await db
      .select({
        userId: collectionMembers.userId,
        displayName: users.displayName,
        email: users.email,
        role: collectionMembers.role,
        createdAt: collectionMembers.createdAt,
      })
      .from(collectionMembers)
      .innerJoin(users, eq(users.id, collectionMembers.userId))
      .where(eq(collectionMembers.collectionId, collectionId))
      .orderBy(asc(collectionMembers.createdAt));
    return rows as Array<{
      userId: number;
      displayName: string;
      email: string;
      role: CollectionRole;
      createdAt: Date;
    }>;
  }

  async addCollectionMember(
    collectionId: number,
    userId: number,
    role: CollectionRole,
  ): Promise<CollectionMember> {
    const [row] = await db
      .insert(collectionMembers)
      .values({ collectionId, userId, role })
      .onConflictDoUpdate({
        target: [collectionMembers.collectionId, collectionMembers.userId],
        set: { role },
      })
      .returning();
    return row;
  }

  async removeCollectionMember(
    collectionId: number,
    userId: number,
  ): Promise<void> {
    await db
      .delete(collectionMembers)
      .where(
        and(
          eq(collectionMembers.collectionId, collectionId),
          eq(collectionMembers.userId, userId),
        ),
      );
  }

  async updateMemberRole(
    collectionId: number,
    userId: number,
    role: CollectionRole,
  ): Promise<CollectionMember | undefined> {
    const [row] = await db
      .update(collectionMembers)
      .set({ role })
      .where(
        and(
          eq(collectionMembers.collectionId, collectionId),
          eq(collectionMembers.userId, userId),
        ),
      )
      .returning();
    return row;
  }

  // ─── Invites ────────────────────────────────────────────

  async createInvite(data: {
    collectionId: number;
    email: string;
    role: CollectionRole;
    invitedBy: number;
  }): Promise<CollectionInvite> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [invite] = await db
      .insert(collectionInvites)
      .values({
        collectionId: data.collectionId,
        email: data.email.toLowerCase(),
        role: data.role,
        token,
        invitedBy: data.invitedBy,
        expiresAt,
      })
      .returning();
    return invite;
  }

  async getInviteByToken(
    token: string,
  ): Promise<
    | (CollectionInvite & {
        collection: { id: number; title: string };
      })
    | undefined
  > {
    const [row] = await db
      .select({
        invite: collectionInvites,
        collection: { id: collections.id, title: collections.title },
      })
      .from(collectionInvites)
      .innerJoin(
        collections,
        eq(collections.id, collectionInvites.collectionId),
      )
      .where(eq(collectionInvites.token, token));
    if (!row) return undefined;
    return { ...row.invite, collection: row.collection };
  }

  async getInvitesForCollection(
    collectionId: number,
  ): Promise<CollectionInvite[]> {
    return db
      .select()
      .from(collectionInvites)
      .where(
        and(
          eq(collectionInvites.collectionId, collectionId),
          isNull(collectionInvites.acceptedAt),
        ),
      )
      .orderBy(desc(collectionInvites.createdAt));
  }

  async acceptInvite(
    token: string,
    userId: number,
  ): Promise<
    { invite: CollectionInvite; member: CollectionMember } | undefined
  > {
    return db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(collectionInvites)
        .where(eq(collectionInvites.token, token));
      if (!invite) return undefined;
      if (invite.acceptedAt) return undefined;
      if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
        return undefined;
      }

      const [updated] = await tx
        .update(collectionInvites)
        .set({ acceptedAt: new Date(), acceptedBy: userId })
        .where(eq(collectionInvites.id, invite.id))
        .returning();

      const [member] = await tx
        .insert(collectionMembers)
        .values({
          collectionId: invite.collectionId,
          userId,
          role: invite.role,
        })
        .onConflictDoUpdate({
          target: [collectionMembers.collectionId, collectionMembers.userId],
          set: { role: invite.role },
        })
        .returning();

      return { invite: updated, member };
    });
  }

  async cancelInvite(inviteId: number): Promise<void> {
    await db
      .delete(collectionInvites)
      .where(eq(collectionInvites.id, inviteId));
  }

  // ─── Publish ────────────────────────────────────────────

  async publishStation(stationId: number): Promise<Station | undefined> {
    const [row] = await db
      .update(stations)
      .set({
        visibility: "public",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stations.id, stationId))
      .returning();
    return row as Station | undefined;
  }

  async unpublishStation(stationId: number): Promise<Station | undefined> {
    const [row] = await db
      .update(stations)
      .set({
        visibility: "private",
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(stations.id, stationId))
      .returning();
    return row as Station | undefined;
  }

  async publishCollection(
    collectionId: number,
  ): Promise<Collection | undefined> {
    const [row] = await db
      .update(collections)
      .set({
        visibility: "public",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collections.id, collectionId))
      .returning();
    return row;
  }

  async unpublishCollection(
    collectionId: number,
  ): Promise<Collection | undefined> {
    const [row] = await db
      .update(collections)
      .set({
        visibility: "private",
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, collectionId))
      .returning();
    return row;
  }

  // ─── Public browsing ───────────────────────────────────

  async listPublicStations(filters: {
    q?: string;
    type?: string;
    specialty?: string;
    difficulty?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: PublicStationSummary[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conds = [eq(stations.visibility, "public")];
    if (filters.q) {
      conds.push(ilike(stations.title, `%${filters.q}%`));
    }
    if (filters.type) {
      conds.push(eq(stations.type, filters.type as any));
    }
    if (filters.specialty) {
      conds.push(eq(stations.specialty, filters.specialty));
    }
    if (filters.difficulty) {
      conds.push(eq(stations.difficulty, filters.difficulty as any));
    }

    // Sort
    let orderByClause;
    switch (filters.sort) {
      case "stars":
        orderByClause = desc(stations.starCount);
        break;
      case "forks":
        orderByClause = desc(stations.forkCount);
        break;
      case "practices":
        orderByClause = desc(stations.practiceCount);
        break;
      case "recent":
      default:
        orderByClause = desc(stations.publishedAt);
        break;
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(stations)
      .where(and(...conds));

    const rows = await db
      .select({
        id: stations.id,
        title: stations.title,
        type: stations.type,
        specialty: stations.specialty,
        difficulty: stations.difficulty,
        tags: stations.tags,
        starCount: stations.starCount,
        forkCount: stations.forkCount,
        practiceCount: stations.practiceCount,
        publishedAt: stations.publishedAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
      })
      .from(stations)
      .innerJoin(users, eq(users.id, stations.userId))
      .where(and(...conds))
      .orderBy(orderByClause)
      .limit(pageSize)
      .offset(offset);

    const items: PublicStationSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as PublicStationSummary["type"],
      specialty: r.specialty,
      difficulty: r.difficulty as PublicStationSummary["difficulty"],
      tags: (r.tags as string[]) ?? [],
      starCount: r.starCount ?? 0,
      forkCount: r.forkCount ?? 0,
      practiceCount: r.practiceCount ?? 0,
      publishedAt: (r.publishedAt ?? new Date()).toISOString(),
      author: { id: r.authorId, displayName: r.authorDisplayName },
    }));

    return { items, total };
  }

  async listPublicCollections(filters: {
    q?: string;
    specialty?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: PublicCollectionSummary[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conds = [eq(collections.visibility, "public")];
    if (filters.q) {
      conds.push(ilike(collections.title, `%${filters.q}%`));
    }
    if (filters.specialty) {
      conds.push(eq(collections.specialty, filters.specialty));
    }

    let orderByClause;
    switch (filters.sort) {
      case "stars":
        orderByClause = desc(collections.starCount);
        break;
      case "forks":
        orderByClause = desc(collections.forkCount);
        break;
      case "recent":
      default:
        orderByClause = desc(collections.publishedAt);
        break;
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(collections)
      .where(and(...conds));

    const rows = await db
      .select({
        id: collections.id,
        title: collections.title,
        description: collections.description,
        specialty: collections.specialty,
        tags: collections.tags,
        starCount: collections.starCount,
        forkCount: collections.forkCount,
        publishedAt: collections.publishedAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
      })
      .from(collections)
      .innerJoin(users, eq(users.id, collections.userId))
      .where(and(...conds))
      .orderBy(orderByClause)
      .limit(pageSize)
      .offset(offset);

    if (rows.length === 0) return { items: [], total };

    const ids = rows.map((r) => r.id);
    const stationCountRows = await db
      .select({
        collectionId: collectionStations.collectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(collectionStations)
      .where(inArray(collectionStations.collectionId, ids))
      .groupBy(collectionStations.collectionId);
    const stationCountMap = new Map<number, number>();
    for (const r of stationCountRows) stationCountMap.set(r.collectionId, r.count);

    const items: PublicCollectionSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      specialty: r.specialty,
      tags: (r.tags as string[]) ?? [],
      starCount: r.starCount ?? 0,
      forkCount: r.forkCount ?? 0,
      stationCount: stationCountMap.get(r.id) ?? 0,
      publishedAt: (r.publishedAt ?? new Date()).toISOString(),
      author: { id: r.authorId, displayName: r.authorDisplayName },
    }));

    return { items, total };
  }

  async getPublicStation(id: number): Promise<
    | (StationWithDetails & {
        author: { id: number; displayName: string };
      })
    | null
  > {
    const station = await this.getStation(id);
    if (!station) return null;
    if ((station as any).visibility !== "public") return null;

    const [author] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, station.userId));

    return { ...station, author } as StationWithDetails & {
      author: { id: number; displayName: string };
    };
  }

  async getPublicCollection(id: number): Promise<
    | (Collection & {
        stations: PublicStationSummary[];
        author: { id: number; displayName: string };
      })
    | null
  > {
    const [row] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id));
    if (!row) return null;
    if (row.visibility !== "public") return null;

    const [author] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, row.userId));

    // Only include public stations inside the collection
    const stationRows = await db
      .select({
        id: stations.id,
        title: stations.title,
        type: stations.type,
        specialty: stations.specialty,
        difficulty: stations.difficulty,
        tags: stations.tags,
        starCount: stations.starCount,
        forkCount: stations.forkCount,
        practiceCount: stations.practiceCount,
        publishedAt: stations.publishedAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
        order: collectionStations.order,
      })
      .from(collectionStations)
      .innerJoin(stations, eq(stations.id, collectionStations.stationId))
      .innerJoin(users, eq(users.id, stations.userId))
      .where(
        and(
          eq(collectionStations.collectionId, id),
          eq(stations.visibility, "public"),
        ),
      )
      .orderBy(asc(collectionStations.order));

    const stationsList: PublicStationSummary[] = stationRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as PublicStationSummary["type"],
      specialty: r.specialty,
      difficulty: r.difficulty as PublicStationSummary["difficulty"],
      tags: (r.tags as string[]) ?? [],
      starCount: r.starCount ?? 0,
      forkCount: r.forkCount ?? 0,
      practiceCount: r.practiceCount ?? 0,
      publishedAt: (r.publishedAt ?? new Date()).toISOString(),
      author: { id: r.authorId, displayName: r.authorDisplayName },
    }));

    return { ...row, stations: stationsList, author };
  }

  // ─── Fork ───────────────────────────────────────────────

  async forkStation(
    sourceId: number,
    newOwnerId: number,
  ): Promise<StationWithDetails> {
    return db.transaction(async (tx) => {
      const source = await db.query.stations.findFirst({
        where: eq(stations.id, sourceId),
        with: {
          sections: {
            orderBy: [asc(sections.order)],
            with: {
              items: {
                orderBy: [asc(items.order)],
                with: {
                  media: { orderBy: [asc(itemMedia.order)] },
                },
              },
            },
          },
          examinerQuestions: {
            orderBy: [asc(examinerQuestions.order)],
          },
        },
      });
      if (!source) {
        throw new Error(`Source station ${sourceId} not found`);
      }

      // 1. Insert new station (private by default, forkOf=source)
      const [newStation] = (await tx
        .insert(stations)
        .values({
          userId: newOwnerId,
          title: source.title,
          type: source.type,
          defaultTimeMinutes: source.defaultTimeMinutes,
          readingTimeMinutes: source.readingTimeMinutes,
          scenario: source.scenario,
          patientBriefing: source.patientBriefing,
          hasPatientBriefing: source.hasPatientBriefing,
          aiPatientEnabled: source.aiPatientEnabled,
          specialty: source.specialty,
          difficulty: source.difficulty,
          tags: source.tags,
          customVocabulary: source.customVocabulary,
          referenceImageUrl: source.referenceImageUrl,
          referenceImageCaption: source.referenceImageCaption,
          forkOf: sourceId,
          visibility: "private",
        })
        .returning()) as Station[];

      // 2. Deep-copy sections / items / sub-items / media.
      // Loop items list with parentItemId populated AND sub-items nested via
      // the query above. Since the query above flattened items by section
      // (no recursive subItems), re-fetch items with parent relations.
      const sourceItems = await db
        .select()
        .from(items)
        .where(
          inArray(
            items.sectionId,
            (source.sections as any[]).map((s) => s.id),
          ),
        );
      const sourceMedia = await db
        .select()
        .from(itemMedia)
        .where(
          inArray(
            itemMedia.itemId,
            sourceItems.map((i) => i.id),
          ),
        );

      // Group items by section
      const itemsBySection = new Map<number, Item[]>();
      for (const it of sourceItems) {
        const arr = itemsBySection.get(it.sectionId) ?? [];
        arr.push(it);
        itemsBySection.set(it.sectionId, arr);
      }
      const mediaByItem = new Map<number, ItemMedia[]>();
      for (const m of sourceMedia) {
        const arr = mediaByItem.get(m.itemId) ?? [];
        arr.push(m);
        mediaByItem.set(m.itemId, arr);
      }

      // id-map from old item id -> new item id (so we can rewire parentItemId)
      const itemIdMap = new Map<number, number>();

      for (const srcSection of source.sections as any[]) {
        const [newSection] = (await tx
          .insert(sections)
          .values({
            stationId: newStation.id,
            title: srcSection.title,
            order: srcSection.order,
            description: srcSection.description ?? null,
            imageUrl: srcSection.imageUrl ?? null,
            imageCaption: srcSection.imageCaption ?? null,
          })
          .returning()) as Section[];

        const sectionItems = itemsBySection.get(srcSection.id) ?? [];
        // Two-pass so we have all IDs before rewiring parents.
        // Pass 1: insert items without parentItemId
        for (const srcItem of sectionItems) {
          const [newItem] = (await tx
            .insert(items)
            .values({
              sectionId: newSection.id,
              parentItemId: null,
              text: srcItem.text,
              isCritical: srcItem.isCritical,
              points: srcItem.points,
              order: srcItem.order,
              explanation: srcItem.explanation,
              imageUrl: srcItem.imageUrl,
              imageCaption: srcItem.imageCaption,
              videoUrl: srcItem.videoUrl,
            })
            .returning()) as Item[];
          itemIdMap.set(srcItem.id, newItem.id);

          // Copy media for this item
          const mediaList = mediaByItem.get(srcItem.id) ?? [];
          for (const m of mediaList) {
            await tx.insert(itemMedia).values({
              itemId: newItem.id,
              type: m.type,
              url: m.url,
              caption: m.caption,
              order: m.order,
            });
          }
        }

        // Pass 2: update parentItemId on new items now that map is populated
        for (const srcItem of sectionItems) {
          if (srcItem.parentItemId != null) {
            const newId = itemIdMap.get(srcItem.id);
            const newParentId = itemIdMap.get(srcItem.parentItemId);
            if (newId && newParentId) {
              await tx
                .update(items)
                .set({ parentItemId: newParentId })
                .where(eq(items.id, newId));
            }
          }
        }
      }

      // 3. Examiner questions
      for (const q of source.examinerQuestions as any[]) {
        await tx.insert(examinerQuestions).values({
          stationId: newStation.id,
          question: q.question,
          questionType: q.questionType ?? "free_text",
          idealAnswer: q.idealAnswer ?? null,
          keyPoints: q.keyPoints,
          config: q.config ?? null,
          imageUrl: q.imageUrl ?? null,
          order: q.order,
        });
      }

      // 4. Bump fork count on source
      await tx
        .update(stations)
        .set({ forkCount: sql`${stations.forkCount} + 1` })
        .where(eq(stations.id, sourceId));

      // Return the new station's id from the transaction so the caller
      // can re-read with a fresh (post-commit) snapshot — reading via
      // `this.getStation` inside the tx uses the outer `db` connection and
      // will miss the uncommitted insert.
      return newStation.id;
    }).then(async (newStationId) => {
      const full = await this.getStation(newStationId);
      if (!full) throw new Error("Fork created but could not read back");
      return full;
    });
  }

  async forkCollection(
    sourceId: number,
    newOwnerId: number,
  ): Promise<Collection> {
    const [source] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, sourceId));
    if (!source) throw new Error(`Source collection ${sourceId} not found`);

    // Pre-fetch station links OUTSIDE the tx so the transaction body is
    // purely writes — the source link order is stable.
    const stationLinks = await db
      .select()
      .from(collectionStations)
      .where(eq(collectionStations.collectionId, sourceId))
      .orderBy(asc(collectionStations.order));

    // Fork each source station BEFORE opening the collection-level
    // transaction. forkStation owns its own atomic unit; doing them up
    // front means: if any single station fork fails, we've written zero
    // collection-level state (no new collection row, no member row, no
    // links, no counter bump). The only tradeoff is that we may have
    // orphaned forked stations on partial failure — acceptable (they just
    // show up as private stations in the new owner's library, same as
    // manual forks would).
    const forkedStations: { stationId: number; order: number }[] = [];
    for (const link of stationLinks) {
      const forked = await this.forkStation(link.stationId, newOwnerId);
      forkedStations.push({ stationId: forked.id, order: link.order });
    }

    // All collection-level writes: new row, owner membership, station
    // links, and source counter bump — wrapped together so the collection
    // either exists fully-linked or not at all.
    return db.transaction(async (tx) => {
      // 1. Create new collection (private, forkOf)
      const [newCollection] = await tx
        .insert(collections)
        .values({
          userId: newOwnerId,
          title: source.title,
          description: source.description,
          specialty: source.specialty,
          tags: source.tags,
          visibility: "private",
          forkOf: sourceId,
        })
        .returning();

      // 2. Owner row in collection_members
      await tx
        .insert(collectionMembers)
        .values({
          collectionId: newCollection.id,
          userId: newOwnerId,
          role: "owner",
        })
        .onConflictDoNothing();

      // 3. Link pre-forked stations into the new collection
      for (const f of forkedStations) {
        await tx.insert(collectionStations).values({
          collectionId: newCollection.id,
          stationId: f.stationId,
          order: f.order,
        });
      }

      // 4. Bump fork count on source collection
      await tx
        .update(collections)
        .set({ forkCount: sql`${collections.forkCount} + 1` })
        .where(eq(collections.id, sourceId));

      return newCollection;
    });
  }

  // ─── Stars ──────────────────────────────────────────────

  async starStation(userId: number, stationId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(stationStars)
        .values({ userId, stationId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) {
        await tx
          .update(stations)
          .set({ starCount: sql`${stations.starCount} + 1` })
          .where(eq(stations.id, stationId));
      }
    });
  }

  async unstarStation(userId: number, stationId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(stationStars)
        .where(
          and(
            eq(stationStars.userId, userId),
            eq(stationStars.stationId, stationId),
          ),
        )
        .returning();
      if (deleted.length > 0) {
        await tx
          .update(stations)
          .set({
            starCount: sql`GREATEST(${stations.starCount} - 1, 0)`,
          })
          .where(eq(stations.id, stationId));
      }
    });
  }

  async starCollection(
    userId: number,
    collectionId: number,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(collectionStars)
        .values({ userId, collectionId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) {
        await tx
          .update(collections)
          .set({ starCount: sql`${collections.starCount} + 1` })
          .where(eq(collections.id, collectionId));
      }
    });
  }

  async unstarCollection(
    userId: number,
    collectionId: number,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(collectionStars)
        .where(
          and(
            eq(collectionStars.userId, userId),
            eq(collectionStars.collectionId, collectionId),
          ),
        )
        .returning();
      if (deleted.length > 0) {
        await tx
          .update(collections)
          .set({
            starCount: sql`GREATEST(${collections.starCount} - 1, 0)`,
          })
          .where(eq(collections.id, collectionId));
      }
    });
  }

  async isStationStarredByUser(
    userId: number,
    stationId: number,
  ): Promise<boolean> {
    const [row] = await db
      .select({ userId: stationStars.userId })
      .from(stationStars)
      .where(
        and(
          eq(stationStars.userId, userId),
          eq(stationStars.stationId, stationId),
        ),
      );
    return !!row;
  }

  async isCollectionStarredByUser(
    userId: number,
    collectionId: number,
  ): Promise<boolean> {
    const [row] = await db
      .select({ userId: collectionStars.userId })
      .from(collectionStars)
      .where(
        and(
          eq(collectionStars.userId, userId),
          eq(collectionStars.collectionId, collectionId),
        ),
      );
    return !!row;
  }

  // ─── Practice count (best-effort) ───────────────────────

  async incrementPracticeCount(stationId: number): Promise<void> {
    try {
      await db
        .update(stations)
        .set({ practiceCount: sql`${stations.practiceCount} + 1` })
        .where(eq(stations.id, stationId));
    } catch (err) {
      // Best-effort, never throws.
      console.warn("incrementPracticeCount failed", err);
    }
  }

  // ─── Reports ────────────────────────────────────────────

  async createReport(data: {
    targetType: ReportTarget;
    targetId: number;
    reporterId: number | null;
    reason: string;
  }): Promise<Report> {
    const [row] = await db
      .insert(reports)
      .values({
        targetType: data.targetType,
        targetId: data.targetId,
        reporterId: data.reporterId ?? null,
        reason: data.reason,
      })
      .returning();
    return row;
  }

  async listReports(
    status?: ReportStatus,
  ): Promise<Array<Report & { targetPreview: { title: string | null } }>> {
    const rows = await (status
      ? db
          .select()
          .from(reports)
          .where(eq(reports.status, status))
          .orderBy(desc(reports.createdAt))
      : db.select().from(reports).orderBy(desc(reports.createdAt)));

    if (rows.length === 0) return [];

    // Batch-load target titles
    const stationIds = rows
      .filter((r) => r.targetType === "station")
      .map((r) => r.targetId);
    const collectionIds = rows
      .filter((r) => r.targetType === "collection")
      .map((r) => r.targetId);
    const userIds = rows
      .filter((r) => r.targetType === "user")
      .map((r) => r.targetId);

    const stationTitleMap = new Map<number, string>();
    if (stationIds.length > 0) {
      const sRows = await db
        .select({ id: stations.id, title: stations.title })
        .from(stations)
        .where(inArray(stations.id, stationIds));
      for (const s of sRows) stationTitleMap.set(s.id, s.title);
    }

    const collectionTitleMap = new Map<number, string>();
    if (collectionIds.length > 0) {
      const cRows = await db
        .select({ id: collections.id, title: collections.title })
        .from(collections)
        .where(inArray(collections.id, collectionIds));
      for (const c of cRows) collectionTitleMap.set(c.id, c.title);
    }

    const userNameMap = new Map<number, string>();
    if (userIds.length > 0) {
      const uRows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of uRows) userNameMap.set(u.id, u.displayName);
    }

    return rows.map((r) => {
      let title: string | null = null;
      if (r.targetType === "station") {
        title = stationTitleMap.get(r.targetId) ?? null;
      } else if (r.targetType === "collection") {
        title = collectionTitleMap.get(r.targetId) ?? null;
      } else if (r.targetType === "user") {
        title = userNameMap.get(r.targetId) ?? null;
      }
      return { ...r, targetPreview: { title } };
    });
  }

  async updateReport(
    id: number,
    data: { status?: ReportStatus; reviewedBy?: number; notes?: string },
  ): Promise<Report | undefined> {
    const patch: Partial<Report> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.reviewedBy !== undefined) patch.reviewedBy = data.reviewedBy;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.status || data.reviewedBy !== undefined) {
      patch.reviewedAt = new Date();
    }
    const [row] = await db
      .update(reports)
      .set(patch)
      .where(eq(reports.id, id))
      .returning();
    return row;
  }

  // ─── Public author profile ──────────────────────────────

  async getUserPublicProfile(id: number): Promise<AuthorProfile | null> {
    const [user] = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        bio: users.bio,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id));
    if (!user) return null;

    // Published stations by this user
    const stationRows = await db
      .select({
        id: stations.id,
        title: stations.title,
        type: stations.type,
        specialty: stations.specialty,
        difficulty: stations.difficulty,
        tags: stations.tags,
        starCount: stations.starCount,
        forkCount: stations.forkCount,
        practiceCount: stations.practiceCount,
        publishedAt: stations.publishedAt,
      })
      .from(stations)
      .where(
        and(
          eq(stations.userId, id),
          eq(stations.visibility, "public"),
        ),
      )
      .orderBy(desc(stations.publishedAt));

    const publishedStations: PublicStationSummary[] = stationRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as PublicStationSummary["type"],
      specialty: r.specialty,
      difficulty: r.difficulty as PublicStationSummary["difficulty"],
      tags: (r.tags as string[]) ?? [],
      starCount: r.starCount ?? 0,
      forkCount: r.forkCount ?? 0,
      practiceCount: r.practiceCount ?? 0,
      publishedAt: (r.publishedAt ?? new Date()).toISOString(),
      author: { id: user.id, displayName: user.displayName },
    }));

    const collectionRows = await db
      .select({
        id: collections.id,
        title: collections.title,
        description: collections.description,
        specialty: collections.specialty,
        tags: collections.tags,
        starCount: collections.starCount,
        forkCount: collections.forkCount,
        publishedAt: collections.publishedAt,
      })
      .from(collections)
      .where(
        and(
          eq(collections.userId, id),
          eq(collections.visibility, "public"),
        ),
      )
      .orderBy(desc(collections.publishedAt));

    const collIds = collectionRows.map((c) => c.id);
    const stationCountMap = new Map<number, number>();
    if (collIds.length > 0) {
      const scRows = await db
        .select({
          collectionId: collectionStations.collectionId,
          count: sql<number>`count(*)::int`,
        })
        .from(collectionStations)
        .where(inArray(collectionStations.collectionId, collIds))
        .groupBy(collectionStations.collectionId);
      for (const r of scRows) stationCountMap.set(r.collectionId, r.count);
    }

    const publishedCollections: PublicCollectionSummary[] = collectionRows.map(
      (r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        specialty: r.specialty,
        tags: (r.tags as string[]) ?? [],
        starCount: r.starCount ?? 0,
        forkCount: r.forkCount ?? 0,
        stationCount: stationCountMap.get(r.id) ?? 0,
        publishedAt: (r.publishedAt ?? new Date()).toISOString(),
        author: { id: user.id, displayName: user.displayName },
      }),
    );

    const totalStars =
      publishedStations.reduce((acc, s) => acc + s.starCount, 0) +
      publishedCollections.reduce((acc, c) => acc + c.starCount, 0);

    return {
      id: user.id,
      displayName: user.displayName,
      bio: user.bio,
      memberSince: user.createdAt.toISOString(),
      publishedStations,
      publishedCollections,
      totalStars,
    };
  }
}

export const storage = new DatabaseStorage();
