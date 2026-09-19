require("dotenv").config();
const express = require("express");
const cors = require("cors");

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

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/categories", categoryRoutes);
app.use("/brands", brandRoutes);
app.use("/suppliers", supplierRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/warehouses", warehouseRoutes);
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

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GasTrack API listening on port ${PORT}`));