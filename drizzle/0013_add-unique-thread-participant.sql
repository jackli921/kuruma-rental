-- Remove any pre-existing duplicate (threadId, userId) rows before adding the constraint.
DELETE FROM "thread_participants" a USING "thread_participants" b
WHERE a."id" > b."id" AND a."threadId" = b."threadId" AND a."userId" = b."userId";

ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_threadId_userId_unique" UNIQUE("threadId","userId");
