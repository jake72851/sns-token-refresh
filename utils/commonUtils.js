const CONF = require('../config');
const { IncomingWebhook } = require('@slack/webhook');

exports.sendMessage = (msg) => {
  const url = CONF.SLACK_WEBHOOK_SNS_ACCOUNT_URL;
  // Initialize
  const webhook = new IncomingWebhook(url);
  webhook.send({
    text: msg,
  });
};
