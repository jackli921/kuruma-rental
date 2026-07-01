CREATE TYPE "public"."catalog_template_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "add_on_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"status" "catalog_template_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_templates_key_unique" ON "add_on_templates" USING btree ("key");
--> statement-breakpoint
-- Catalog i18n seed: curated add-on templates (H1 source = DEMO_ADD_ON_TEMPLATES).
-- Ships to production via this migration; the demo seed re-upserts the same rows.
-- Idempotent on the natural key so a rerun / warm DB is a no-op.
INSERT INTO "add_on_templates" ("id", "key", "name", "description") VALUES
	('366823c3-d8c0-4e82-a262-e6309728bd02', 'child_seat', '{"en":"Child seat","ja":"チャイルドシート","zh":"儿童座椅"}'::jsonb, '{"en":"Rear-facing or booster seat, fitted at pickup.","ja":"後ろ向きまたはブースターシート。受け取り時に取り付けます。","zh":"后向式或增高座椅，取车时安装。"}'::jsonb),
	('12fe87a3-254f-4802-9eaa-193baaff66f4', 'etc_card', '{"en":"ETC card","ja":"ETCカード","zh":"ETC 卡"}'::jsonb, '{"en":"Expressway toll card — pay tolls automatically, settle on return.","ja":"高速道路料金カード。通行料を自動精算し、返却時にお支払いいただきます。","zh":"高速公路收费卡，自动缴纳过路费，还车时结算。"}'::jsonb),
	('4d6b5c48-5ad9-49b1-a6bc-c95fa61d45fc', 'additional_driver', '{"en":"Additional driver","ja":"追加ドライバー","zh":"附加驾驶员"}'::jsonb, '{"en":"Register a second named driver on the rental agreement.","ja":"レンタル契約に2人目の運転者を登録します。","zh":"在租赁协议上登记第二位指定驾驶员。"}'::jsonb),
	('1b699eb2-e156-4063-9790-e8595f82df2c', 'pocket_wi_fi', '{"en":"Pocket Wi-Fi","ja":"ポケットWi-Fi","zh":"随身 Wi-Fi"}'::jsonb, '{"en":"Unlimited 4G pocket router for the trip.","ja":"旅行中に使える無制限4Gポケットルーター。","zh":"旅途中可用的无限流量 4G 随身路由器。"}'::jsonb),
	('502bc590-01d2-4433-849b-ebbd99adb6e6', 'snow_tires', '{"en":"Snow tires","ja":"スノータイヤ","zh":"雪地轮胎"}'::jsonb, '{"en":"Studless winter tires for mountain and snow-country routes.","ja":"山道や雪国のルート向けのスタッドレスタイヤ。","zh":"适合山路和雪国路线的无钉防滑冬季轮胎。"}'::jsonb),
	('ce507b20-3002-415f-95d8-a887b099faaa', 'english_gps_navigation', '{"en":"English GPS navigation","ja":"英語カーナビ","zh":"英语 GPS 导航"}'::jsonb, '{"en":"Dashboard navigation unit with an English voice + map.","ja":"英語の音声と地図に対応したダッシュボードナビ。","zh":"配备英语语音和地图的车载导航仪。"}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
