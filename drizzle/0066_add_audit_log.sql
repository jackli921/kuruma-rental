CREATE TYPE "public"."audit_event_kind" AS ENUM('PROVIDER_INVITE_CREATED', 'OPERATOR_PROFILE_UPDATED', 'OPERATOR_MEMBER_DEACTIVATED');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "audit_event_kind" NOT NULL,
	"actorUserId" text NOT NULL,
	"operatorId" text,
	"targetId" text,
	"field" text,
	"oldValue" text,
	"newValue" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_audit_log_operatorId" ON "audit_log" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_audit_log_kind" ON "audit_log" USING btree ("kind");