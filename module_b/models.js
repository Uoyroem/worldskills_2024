const { Sequelize, DataTypes, QueryInterface } = require("sequelize");
const crypto = require("crypto");
const sequelize = new Sequelize({
  username: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  port: process.env.MYSQL_PORT,
  host: process.env.MYSQL_HOST,
  dialect: "mysql",
  database: process.env.MYSQL_DATABASE,
});
const User = sequelize.define("User", {
  username: {
    type: DataTypes.STRING(256),
    unique: true,
  },
  passwordHash: {
    type: DataTypes.TEXT,
  },
});

const Workspace = sequelize.define(
  "Workspace",
  {
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
  },
  {
    indexes: [
      {
        fields: ["ownerId", "title"],
        unique: true,
      },
    ],
  }
);

User.Workspaces = User.hasMany(Workspace, {
  as: "workspaces",
  foreignKey: {
    name: "ownerId",
    allowNull: false,
  },
});
Workspace.Owner = Workspace.belongsTo(User, { as: "owner" });

const APIToken = sequelize.define(
  "APIToken",
  {
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    token: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue() {
        return crypto.randomBytes(20).toString("hex");
      },
    },
    revokedAt: {
      type: DataTypes.DATE,
    },
  },
  {
    updatedAt: false,
  }
);

Workspace.APITokens = Workspace.hasMany(APIToken, {
  as: "apiTokens",
  onDelete: "CASCADE",
  foreignKey: {
    name: "workspaceId",
    allowNull: false,
  },
});
APIToken.Workspace = APIToken.belongsTo(Workspace, { as: "workspace" });

const BillingQuota = sequelize.define("BillingQuota", {
  limit: {
    type: DataTypes.REAL,
    allowNull: false,
  },
});

Workspace.BillingQuota = Workspace.hasOne(BillingQuota, {
  as: "billingQuota",
  foreignKey: {
    name: "workspaceId",
  },
});
BillingQuota.Workspace = BillingQuota.belongsTo(Workspace, { as: "workspace" });

const Service = sequelize.define("Service", {
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  costPerMs: {
    type: DataTypes.REAL,
    allowNull: false,
  },
});

APIToken.Services = APIToken.hasMany(Service, {
  as: "services",
  foreignKey: {
    name: "apiTokenId",
    allowNull: false,
  },
});
Service.APIToken = Service.belongsTo(APIToken, { as: "apiToken" });

const Bill = sequelize.define(
  "Bill",
  {
    usageStartedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    usageDurationInMs: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    updatedAt: false,
  }
);

Service.Bills = Service.hasMany(Bill, {
  as: "bills",
  foreignKey: {
    name: "serviceId",
    allowNull: false,
  },
});
Bill.Service = Bill.belongsTo(Service, { as: "service" });

module.exports = {
  sequelize,
  User,
  Workspace,
  APIToken,
  Bill,
  BillingQuota,
  Service,
};
