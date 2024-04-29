require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const sequelize = require("sequelize");
const SequelizeSessionStore = require("express-session-sequelize")(
  session.Store
);
const models = require("./models.js");

const PORT = process.env.PORT;
const SECRET = process.env.SECRET;
const SALT_ROUNDS = 10;
const app = express();
const STATIC_URL = "/static";
const STATIC_ROOT = "public";
models.sequelize.connectionManager.getConnection();
app.use(STATIC_URL, express.static(path.resolve(__dirname, STATIC_ROOT)));
const sequelizeSessionStore = new SequelizeSessionStore({
  db: models.sequelize,
});
app.use(
  session({
    secret: SECRET,
    resave: false,
    store: sequelizeSessionStore,
    saveUninitialized: false,
  })
);
app.use(async function (req, res, next) {
  res.locals.user = null;

  if (req.session.userId) {
    res.locals.user = await models.User.findOne({
      where: { id: req.session.userId },
      include: [
        {
          association: models.User.Workspaces,
          include: [
            {
              association: models.Workspace.APITokens,
            },
          ],
        },
      ],
    });
  }
  next();
});
app.use(express.urlencoded({ extended: false }));
app.set("views", path.resolve(__dirname, "views"));
app.set("view engine", "pug");
app.locals.static = function (relativeUrl) {
  return STATIC_URL + "/" + relativeUrl;
};
function loginRequired(req, res, next) {
  if (res.locals.user) {
    next();
  } else {
    res.redirect("/login");
  }
}
app.get("/", loginRequired, function (req, res) {
  res.render("pages/index");
});
app.get(
  "/workspaces/:workspaceId/bills",
  loginRequired,
  async function (req, res) {
    const month = req.query.month ? new Date(req.query.month) : null;
    const workspace = await models.Workspace.findOne({
      group: ["apiTokens.id", "apiTokens->services.id"],
      where: { id: req.params.workspaceId },
      include: [
        models.Workspace.Owner,

        {
          association: models.Workspace.APITokens,
          include: [
            {
              association: models.APIToken.Services,
              attributes: {
                include: [
                  [
                    sequelize.literal(
                      `SUM(\`apiTokens->services->bills\`.usageDurationInMs) / 1000`
                    ),
                    "time",
                  ],
                ],
              },
              include: [{ association: models.Service.Bills, attributes: [] }],
            },
          ],
        },
      ],
    });
    if (workspace == null) {
      res.render("pages/404.pug", { description: "Workspace not found" });
      return;
    }
    if (workspace.owner.id !== res.locals.user.id) {
      res.render("pages/403.pug", { description: "Workspace not found" });
      return;
    }
    res.render("pages/workspaces/detail/bills.pug", {
      workspace,
      month,
    });
  }
);
app
  .route("/login")
  .get(function (req, res) {
    res.render("pages/login");
  })
  .post(async function (req, res) {
    const username = req.body.username;
    const password = req.body.password;
    const user = await models.User.findOne({ where: { username } });
    if (user != null && (await bcrypt.compare(password, user.passwordHash))) {
      req.session.userId = user.id;
      res.redirect("/");
      return;
    }
    res.render("pages/login", { error: "Логин или пароль не верные" });
  });
app
  .route("/workspaces/creation")
  .get(loginRequired, function (req, res) {
    res.render("pages/workspaces/create");
  })
  .post(loginRequired, function (req, res) {});
app
  .route("/register")
  .get(function (req, res) {
    res.render("pages/register");
  })
  .post(async function (req, res) {
    const username = req.body.username;
    const password = req.body.password;
    const passwordRepeat = req.body["password-repeat"];
    if (password != passwordRepeat) {
      res.status(400).render("pages/register", {
        errors: {
          password: "Пароли не совподают",
        },
      });
      return;
    }
    if (await register(username, password)) {
      res.redirect("/login");
      return;
    }
    res.status(400).render("pages/register", {
      errors: {
        username: "Такое имя пользователя уже существует",
      },
    });
  });

async function register(username, password) {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  const passwordHash = await bcrypt.hash(password, salt);
  let user = null;
  try {
    user = await models.User.create({
      username,
      passwordHash,
    });
  } catch (error) {
    console.log(error);
  }
  return user;
}

async function importData() {
  const demo1 = await register("demo1", "skills2023d1");
  const demo2 = await register("demo2", "skills2023d2");
  const workspaces = {};
  const workspaceApiTokens = {};
  const workspaceApiTokenServices = {};

  await require("fast-csv")
    .parseFile("service_usages.csv", { headers: true })
    .forEach(async (row) => {
      let user = null;
      if (row.username === "demo1") {
        user = demo1;
      } else {
        user = demo2;
      }

      let workspace = null;
      if (row.workspace_title in workspaces) {
        workspace = workspaces[row.workspace_title];
      } else {
        workspace = workspaces[row.workspace_title] =
          await models.Workspace.create({
            title: row.workspace_title,
            ownerId: user.id,
          });
      }
      let apiToken = null;
      if (!(row.workspace_title in workspaceApiTokens)) {
        workspaceApiTokens[row.workspace_title] = {};
      }
      if (row.api_token_name in workspaceApiTokens[row.workspace_title]) {
        apiToken = workspaceApiTokens[row.workspace_title][row.api_token_name];
      } else {
        apiToken = workspaceApiTokens[row.workspace_title][row.api_token_name] =
          await models.APIToken.create({
            name: row.api_token_name,
            workspaceId: workspace.id,
          });
      }
      if (!(row.workspace_title in workspaceApiTokenServices)) {
        workspaceApiTokenServices[row.workspace_title] = {};
      }
      if (
        !(row.api_token_name in workspaceApiTokenServices[row.workspace_title])
      ) {
        workspaceApiTokenServices[row.workspace_title][row.api_token_name] = {};
      }
      let service = null;
      if (
        row.service_name in
        workspaceApiTokenServices[row.workspace_title][row.api_token_name]
      ) {
        service =
          workspaceApiTokenServices[row.workspace_title][row.api_token_name][
            row.service_name
          ];
      } else {
        service = workspaceApiTokenServices[row.workspace_title][
          row.api_token_name
        ][row.service_name] = await models.Service.create({
          name: row.service_name,
          costPerMs: row.service_cost_per_ms,
          apiTokenId: apiToken.id,
        });
      }
      await models.Bill.create({
        serviceId: service.id,
        usageStartedAt: row.usage_started_at,
        usageDurationInMs: row.usage_duration_in_ms,
      });
    });
}

(async () => {
  // await models.sequelize.sync();
  // await importData();
  app.listen(PORT);
})();
