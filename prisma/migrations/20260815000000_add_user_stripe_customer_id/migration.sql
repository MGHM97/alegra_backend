-- AlterTable
ALTER TABLE "users" ADD COLUMN     "stripe_customer_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "saved_cards_user_id_stripe_payment_method_id_key" ON "saved_cards"("user_id", "stripe_payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");
