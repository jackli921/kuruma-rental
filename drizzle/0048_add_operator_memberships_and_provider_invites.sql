CREATE TYPE "public"."operator_membership_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."operator_role" AS ENUM('OPERATOR_OWNER', 'OPERATOR_STAFF');--> statement-breakpoint
CREATE TYPE "public"."provider_invite_status" AS ENUM('PENDING', 'ACCEPTED');--> statement-breakpoint
CREATE TABLE "operator_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"operatorId" text NOT NULL,
	"role" "operator_role" NOT NULL,
	"status" "operator_membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"operatorId" text NOT NULL,
	"role" "operator_role" NOT NULL,
	"tokenHash" text NOT NULL,
	"status" "provider_invite_status" DEFAULT 'PENDING' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"invitedByUserId" text,
	"acceptedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_memberships" ADD CONSTRAINT "operator_memberships_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_memberships" ADD CONSTRAINT "operator_memberships_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_invites" ADD CONSTRAINT "provider_invites_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_invites" ADD CONSTRAINT "provider_invites_invitedByUserId_users_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_invites" ADD CONSTRAINT "provider_invites_acceptedByUserId_users_id_fk" FOREIGN KEY ("acceptedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_memberships_active_user_unique" ON "operator_memberships" USING btree ("userId") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_operator_memberships_operatorId" ON "operator_memberships" USING btree ("operatorId");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_invites_tokenHash_unique" ON "provider_invites" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "idx_provider_invites_email" ON "provider_invites" USING btree ("email");