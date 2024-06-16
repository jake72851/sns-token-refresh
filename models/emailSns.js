const mongoose = require('mongoose');

const emailSnsSchema = mongoose.Schema(
  {
    userId: {
      type: String,
      trim: true,
      required: false,
    },

    userEmail: {
      type: String,
      trim: true,
      required: false,
    },

    snsType: {
      type: String,
    },

    // 만료, 오류
    mailType: {
      type: String,
    },

    // 발송 결과
    isSent: {
      type: Boolean,
    },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

module.exports = mongoose.model('email_sns', emailSnsSchema);
