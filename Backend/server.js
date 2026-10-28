require("dotenv").config();
if (!process.env.TZ) process.env.TZ = "Asia/Manila";
const express = require("express");
const cors = require("cors");
const path = require("path");

const { notFound, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const brandRoutes = require("./routes/brandRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const userRoutes = require("./routes/userRoutes");
const customerRoutes = require("./routes/customerRoutes");
const orderRoutes = require("./routes/orderRoutes");
const salesRoutes = require("./routes/salesRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const restockRoutes = require("./routes/restockRoutes");
const purchaseOrderRoutes = require("./routes/purchaseOrderRoutes");
const dataRoutes = require("./routes/dataRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const reportRoutes = require("./routes/reportRoutes");
const roleRoutes = require("./routes/roleRoutes");
const settingsRoutes = require("./routes/settingsRoutes");

const app = express();

// Configured allowed origins list
const allowedOrigins = [
  "https://gastrack-frontend-v2.vercel.app",
  
];

// Add process.env.CORS_ORIGIN if set and not already included
if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(",").forEach((origin) => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow non-browser requests (e.g. mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      // Check against allowed list, any .vercel.app domain, or localhost
      if (
        allowedOrigins.includes(origin) ||
        /\.vercel\.app$/.test(origin) ||
        origin.includes("localhost")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "5mb" }));

// Serve static image/file uploads directly
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/contact", require("./routes/contactRoutes"));

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/categories", categoryRoutes);
app.use("/brands", brandRoutes);
app.use("/suppliers", supplierRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/warehouses", warehouseRoutes);
app.use("/user-settings", require("./routes/userSettingsRoutes"));
app.use("/users", userRoutes);
app.use("/customers", customerRoutes);
app.use("/orders", orderRoutes);
app.use("/sales", salesRoutes);
app.use("/payments", paymentRoutes);
app.use("/deliveries", deliveryRoutes);
app.use("/restocking", restockRoutes);
app.use("/purchase-orders", purchaseOrderRoutes);
app.use("/data", dataRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/reports", reportRoutes);
app.use("/roles", roleRoutes);
app.use("/settings", settingsRoutes);
app.use("/delivery-fee", require("./routes/deliveryFeeRoutes"));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GasTrack API listening on port ${PORT}`));


