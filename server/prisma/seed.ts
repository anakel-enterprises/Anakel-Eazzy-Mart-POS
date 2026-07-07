import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { id: "seed-store" },
    update: {},
    create: {
      id: "seed-store",
      name: "Anakel Eazzy Mart",
      address: "Nairobi, Kenya",
      phone: "+254700000000",
      currency: "KES",
      taxRate: 16,
    },
  });

  const adminPasswordHash = await bcrypt.hash("admin123", 10);
  const cashierPasswordHash = await bcrypt.hash("cashier123", 10);

  await prisma.user.upsert({
    where: { email: "admin@eazzymart.co.ke" },
    update: {},
    create: {
      storeId: store.id,
      name: "Grace M.",
      email: "admin@eazzymart.co.ke",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
    },
  });

  await prisma.user.upsert({
    where: { email: "cashier@eazzymart.co.ke" },
    update: {},
    create: {
      storeId: store.id,
      name: "John K.",
      email: "cashier@eazzymart.co.ke",
      passwordHash: cashierPasswordHash,
      role: "CASHIER",
    },
  });

  const categoryNames = ["Cooking Oil", "Grains", "Bakery", "Household", "Beverages", "Snacks"];
  const categories = new Map<string, string>();
  for (const name of categoryNames) {
    const category = await prisma.category.upsert({
      where: { storeId_name: { storeId: store.id, name } },
      update: {},
      create: { storeId: store.id, name },
    });
    categories.set(name, category.id);
  }

  const products = [
    { name: "Sunflower Oil 2L", sku: "OIL-2L-001", barcode: "6161100000011", category: "Cooking Oil", price: 650, cost: 520, stockQty: 3, lowStockThreshold: 8 },
    { name: "Maize Flour 2kg", sku: "FLR-2K-001", barcode: "6161100000028", category: "Grains", price: 220, cost: 170, stockQty: 5, lowStockThreshold: 10 },
    { name: "White Bread", sku: "BRD-001", barcode: "6161100000035", category: "Bakery", price: 65, cost: 45, stockQty: 4, lowStockThreshold: 6 },
    { name: "Bar Soap 800g", sku: "SOAP-800-001", barcode: "6161100000042", category: "Household", price: 180, cost: 130, stockQty: 6, lowStockThreshold: 8 },
    { name: "Rice 2kg", sku: "RICE-2K-001", barcode: "6161100000059", category: "Grains", price: 340, cost: 260, stockQty: 25, lowStockThreshold: 8 },
    { name: "Soda 500ml", sku: "SODA-500-001", barcode: "6161100000066", category: "Beverages", price: 70, cost: 50, stockQty: 60, lowStockThreshold: 15 },
    { name: "Potato Crisps 100g", sku: "CRISP-100-001", barcode: "6161100000073", category: "Snacks", price: 100, cost: 70, stockQty: 40, lowStockThreshold: 10 },
    { name: "Milk 500ml", sku: "MILK-500-001", barcode: "6161100000080", category: "Beverages", price: 60, cost: 45, stockQty: 30, lowStockThreshold: 12 },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { storeId_sku: { storeId: store.id, sku: p.sku } },
      update: {},
      create: {
        storeId: store.id,
        categoryId: categories.get(p.category),
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: p.price,
        cost: p.cost,
        stockQty: p.stockQty,
        lowStockThreshold: p.lowStockThreshold,
      },
    });
  }

  console.log("Seed complete:", { store: store.name, users: 2, categories: categoryNames.length, products: products.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
