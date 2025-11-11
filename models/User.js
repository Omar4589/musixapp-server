import mongoose from "mongoose";
import bcrypt from "bcrypt";

const rounds = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);

const PreferencesSchema = new mongoose.Schema(
  {
    // start new users with nothing selected
    preferredLanguages: { type: [String], default: [] },
    genres: { type: [String], default: [] },
  },
  { _id: false }
);

const ProvidersSchema = new mongoose.Schema(
  {
    spotify: {
      userId: { type: String, default: null, index: true },
      refreshToken: { type: String, default: null },
      scope: { type: [String], default: [] },
      linkedAt: { type: Date, default: null },
    },
    apple: {
      musicUserToken: { type: String, default: null },
      subscriptionActive: { type: Boolean, default: null },
      linkedAt: { type: Date, default: null },
    },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    email: {
      type: String,
      unique: true,
      index: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      unique: true,
      index: true,
      required: true,
      lowercase: true, // normalized version used for login & uniqueness
      trim: true,
    },
    displayUsername: {
      type: String,
      required: true,
      trim: true, // keeps original casing the user typed (OmarZ4589)
    },
    // Store hashed password in "password"; keep it hidden by default
    password: { type: String, required: true, select: false },
    roles: { type: [String], default: ["user"] },
    isActive: { type: Boolean, default: true },
    deactivatedAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
    preferences: { type: PreferencesSchema, default: () => ({}) },
    providers: { type: ProvidersSchema, default: () => ({}) },
    activeProvider: {
      type: String,
      enum: ["spotify", "apple", null],
      default: null,
    },
  },
  { timestamps: true }
);

// ---- Virtuals ----
UserSchema.virtual("fullName").get(function () {
  const fn = this.firstName?.trim() || "";
  const ln = this.lastName?.trim() || "";
  return `${fn} ${ln}`.trim();
});

// ---- Hooks ----
// Hash on create / when modified (uses "this" => must be function)
UserSchema.pre("save", async function (next) {
  try {
    // If password field is selected & changed
    if (this.isNew || this.isModified("password")) {
      this.password = await bcrypt.hash(this.password, rounds);
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Hash on findOneAndUpdate({ password })
UserSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const update = this.getUpdate() || {};
    const pwd = update.password || (update.$set && update.$set.password);
    if (pwd) {
      const hashed = await bcrypt.hash(pwd, rounds);
      if (update.$set) {
        update.$set.password = hashed;
      } else {
        update.password = hashed;
      }
      this.setUpdate(update);
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Friendly duplicate error (email/username)
UserSchema.post("save", function (error, _doc, next) {
  if (error?.name === "MongoServerError" && error?.code === 11000) {
    const fields = Object.keys(error.keyPattern || {});
    const which = fields.length ? fields.join(", ") : "Email or Username";
    next(new Error(`${which} already exists. Please use a different one.`));
  } else {
    next(error);
  }
});

// ---- Methods ----
UserSchema.methods.isCorrectPassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

UserSchema.methods.deactivate = async function () {
  this.isActive = false;
  this.deactivatedAt = new Date();
  return this.save();
};

UserSchema.methods.reactivate = async function () {
  this.isActive = true;
  this.deactivatedAt = null;
  return this.save();
};

export const User = mongoose.model("User", UserSchema);
