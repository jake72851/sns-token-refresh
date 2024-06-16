const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const logger = require('morgan');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

const CONF = require('./config');

// Setup Mongoose DB
const url = CONF.db.url;
// const url = CONF.db_localhost.url

const option = CONF.db.option;
// const option = CONF.db_localhost.option

mongoose.Promise = global.Promise;
mongoose
  .connect(url, option)
  .then(() => console.log('connnect DB success'))
  .catch((err) => console.log('could not connect to the database.\n' + err));

app.use(helmet());
app.use(cors());
app.use(logger('combined'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const SRC_ROUTES = [
  'cron',
];

SRC_ROUTES.forEach((route) => {
  app.use(`/${route}`, require(`./routes/${route}`));
});

const port = CONF.server.port.http;

app.listen(port, () => {
  console.log(`Server on ${port}`);
});
