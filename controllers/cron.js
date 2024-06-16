const mongoose = require('mongoose');
const schedule = require('node-schedule');
const axios = require('axios');
const qs = require('qs');

const User = require('../models/users');
const EmailSns = require('../models/emailSns');

const CONF = require('../config');

const utils = require('../utils/commonUtils');

const { google } = require('googleapis');
const oauth2Client = new google.auth.OAuth2(
  CONF.YOUTUBE_CLIENT_ID, // Google Cloud에서 생성한 OAuth 2.0 클라이언트 ID
  CONF.YOUTUBE_CLIENT_SECRET, // 클라이언트 시크릿
  CONF.YOUTUBE_REDIRECT_URL, // 리다이렉트 url
);

// db 저장 처리 유무
const db_flag = true;
// const db_flag = false;

// mail 발송 처리 유무
const mail_flag = true;
// const mail_flag = false;

// 12시 실행 job
let job12;
// 24시 실행 job
let job24;

// tiktok cron을 관리할 object
const job_tiktok = {};

// 사용자 오류 메일 발송
async function mailing(userInfo, platform, mailType) {
  // console.log('mailing > userInfo =', userInfo);
  try {
    // 이전에 이미 메일을 발송한적이 있고 발송한지 3일이 안된 경우 체크
    const sendData = await EmailSns.findOne({
      userId: userInfo._id,
      snsType: platform,
      createdAt: { $gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      // createdAt: { $gte: moment().subtract(3, 'days').format() },
    }).sort({ createdAt: -1 });

    // 발송기록이 없을때만 발송
    if (!sendData) {
      // 메일 발송을 위한 구독 상태 확인
      const registerResult = await addSubscriberList(userInfo);

      if (registerResult.isSuccessed) {
        const data = {
          name: userInfo.userName,
          platform: platform,
          subscriber: userInfo.userEmail,
        };

        // user countryCode에 따라 템플릿 분기 처리
        let template_url = CONF.STIBEE_URL_KR;
        if (userInfo.countryCode !== 'KR') template_url = CONF.STIBEE_URL_ETC;

        const config = {
          method: 'post',
          url: template_url,
          headers: {
            'Content-Type': 'application/json',
            AccessToken: CONF.STIBEE_ACCESS_TOKEN,
          },
          data,
        };

        let isSent = false;
        if (mail_flag) {
          await axios(config).then(async function (res) {
            console.log(res.data);
            if (res.data == 'ok') {
              console.log('MAIL_SUCCESS');
              isSent = true;
            } else {
              console.log('MAIL_FAIL');
              isSent = false;
              throw res.data;
            }
          });
        } else {
          console.log('MAIL_TEST');
        }

        // 사용자 메일 발송 결과 저장 - 3일 간격으로 발송
        const newMail = new EmailSns({
          userId: userInfo._id,
          userEmail: userInfo.userEmail,
          snsType: platform,
          mailType: mailType,
          isSent: isSent,
        });
        await newMail.save();

        // vplate slack webhook add
        utils.sendMessage(
          `${userInfo.userName}(${userInfo._id})님의 SNS 계정(${platform})에 오류가 발생하였습니다.`,
        );
      }
    } else {
      console.log('mailing > 메일발송 기록 있음! 안보냄!');
    }
  } catch (error) {
    console.error('mailing > error.response.status =', error.response.status);
    console.error('mailing > error.response.data =', error.response.data);
  }
}

async function addSubscriberList(userInfo) {
  const data = JSON.stringify({
    eventOccuredBy: 'MANUAL',
    confirmEmailYN: 'N',
    subscribers: [
      {
        email: userInfo.userEmail,
        name: userInfo.userName,
      },
    ],
  });

  const config = {
    method: 'post',
    url: CONF.STIBEE_SUBSCRIBER_URL,
    headers: {
      'Content-Type': 'application/json',
      AccessToken: CONF.STIBEE_ACCESS_TOKEN,
    },
    data: data,
  };

  let isSuccessed = false;
  let errMsg = '';

  await axios(config).then(async function (res) {
    if (res.data.Ok) {
      console.log('REGISTER_SUCCESS');
      isSuccessed = true;
    } else {
      console.log('REGISTER_FAIL');
      isSuccessed = false;
      errMsg = res.data.Error;
    }
  });

  return {
    isSuccessed: isSuccessed,
    errMsg: errMsg,
  };
}

async function facebook() {
  const user = await User.find({
    'snsAccount.facebook.tokenInfo.access_token': { $exists: true },
  });

  for (const item of user) {
    try {
      // 토큰 디버깅 - 재 로그인시 만료일자가 없어서 추가
      // 오류 case - 토큰 자체다 다른 개발자앱과 연동된 토큰이라면 BAD_REQUEST
      const debugUrl =
        CONF.FACEBOOK_API_URL +
        'debug_token?input_token=' +
        item.snsAccount.facebook.tokenInfo.access_token +
        '&access_token=' +
        CONF.FACEBOOK_APP_TOKEN;
      const debugResult = await axios.get(debugUrl);

      const userInfo = debugResult.data.data;

      // 토큰정보가 유효하지 않으면 초기화
      if (!userInfo.is_valid) {
        console.log('유효하지 않은 토큰! 페이스북 로그인 필요');
        if (db_flag) {
          await User.updateOne(
            { _id: item._id },
            {
              $set: {
                'snsAccount.facebook': {},
                // 'snsAccount.facebookStatus': 'expired',
              },
            },
          );
          console.log('db 업데이트 완료!');
        }
        // 사용자에게 계장연동 오류 최초 메일링을 발송
        await mailing(item, 'facebook', 'expired');
      } else {
        console.log('유효 토큰! 페이스북 로그인 불필요');
      }
    } catch (error) {
      // console.error('error =', error);
      // console.error('error.response =', error.response);
      console.error('error.response.status =', error.response.status);
      console.error('error.response.data =', error.response.data);
      /*
          error.response.status = 400
          error.response.data = {
            error: {
                message: '(#100) The App_id in the input_token did not match the Viewing App',
                type: 'OAuthException',
                code: 100,
                fbtrace_id: 'AK0wueGXo7RGO2q-zgIATr0'
            }
          }
          */
      console.error('에러 토큰! 페이스북 로그인 필요');
      if (db_flag) {
        await User.updateOne(
          { _id: item._id },
          {
            $set: {
              'snsAccount.facebook': {},
              // 'snsAccount.facebookStatus': 'error',
            },
          },
        );
        console.log('db 업데이트 완료!');
      }
      // 사용자에게 계장연동 오류 최초 메일링을 발송
      await mailing(item, 'facebook', 'error');
    }
    // }
  }
}
async function instagram() {
  const user = await User.find({
    'snsAccount.instagram.tokenInfo.access_token': { $exists: true },
  });

  for (const item of user) {
    try {
      // 토큰 디버깅 - 재 로그인시 만료일자가 없어서 추가
      // 오류 case - 토큰 자체다 다른 개발자앱과 연동된 토큰이라면 BAD_REQUEST
      const debugUrl =
        CONF.FACEBOOK_API_URL +
        'debug_token?input_token=' +
        item.snsAccount.instagram.tokenInfo.access_token +
        '&access_token=' +
        CONF.FACEBOOK_APP_TOKEN;
      const debugResult = await axios.get(debugUrl);

      const userInfo = debugResult.data.data;

      // 토큰정보가 유효하지 않으면 갱신시도
      if (!userInfo.is_valid) {
        console.log('유효하지 않은 토큰! 페이스북 로그인 필요');
        if (db_flag) {
          await User.updateOne(
            { _id: item._id },
            {
              $set: {
                'snsAccount.instagram': {},
                // 'snsAccount.instagramStatus': 'expired',
              },
            },
          );
          console.log('db 업데이트 완료!');
        }
        // 사용자에게 계장연동 오류 최초 메일링을 발송
        await mailing(item, 'instagram', 'expired');
      } else {
        console.log('유효 토큰! 페이스북 로그인 불필요');
      }
    } catch (error) {
      console.error('error.response.status =', error.response.status);
      console.error('error.response.data =', error.response.data);
      console.error('에러 토큰! 인스타그램 로그인 필요');
      if (db_flag) {
        await User.updateOne(
          { _id: item._id },
          {
            $set: {
              'snsAccount.instagram': {},
              // 'snsAccount.instagramStatus': 'error',
            },
          },
        );
        console.log('db 업데이트 완료!');
      }
      // 사용자에게 계장연동 오류 최초 메일링을 발송
      await mailing(item, 'instagram', 'error');
    }
  }
}
async function youtube() {
  const user = await User.find({
    'snsAccount.youtube.tokenInfo.refresh_token': { $exists: true },
  });

  for (const item of user) {
    try {
      // 구글은 토큰 디버깅이 없기 때문에 테스트로 사용자 정보를 요청해보자
      oauth2Client.setCredentials({
        access_token: item.snsAccount.youtube.tokenInfo.access_token,
        refresh_token: item.snsAccount.youtube.tokenInfo.refresh_token,
      });

      // 테스트로 사용자 정보 요청
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
    } catch (error) {
      console.error('에러 토큰! 유튜브 로그인 필요');

      // 만약 만료시간전에 예상하지 못한 오류가 발생했다면 어쩔수없이 재로그인 필요
      if (db_flag) {
        await User.updateOne(
          { _id: item._id },
          {
            $set: {
              'snsAccount.youtube': {},
              // 'snsAccount.youtubeStatus': 'error',
            },
          },
        );
      }
      // 사용자에게 계장연동 오류 최초 메일링을 발송
      await mailing(item, 'youtube', 'error');
    }
  }
}

// 틱톡은 12시, 24시 실행하여 db에서 처리가 필요한 사용자를 검색하고 스케쥴링을 생성한다
async function tiktokCronRegister() {
  const user = await User.find({
    'snsAccount.tiktok.tokenInfo.expires_createdAt': { $exists: true },
  });

  for (const item of user) {
    const refreshToken = item.snsAccount.tiktok.tokenInfo.refresh_token;

    // refreshToken이 없는 경우는 초기화하고 메일발송
    if (refreshToken) {
      // cron 시간 생성
      const givenTime = item.snsAccount.tiktok.tokenInfo.expires_createdAt;
      const cronExpression = await createOneHourBeforeCronExpression(givenTime);

      // 기존에 돌고 있는 cron이 있으면 넘어감
      if (!job_tiktok[item._id]) {
        // 틱톡 사용자별 cron 생성
        job_tiktok[item._id] = schedule.scheduleJob(
          cronExpression,
          async () => {
            await tiktokCronJob(refreshToken, item);
          },
        );
      } else {
        console.log('tiktokCronRegister > 기존 틱톡 사용자 cron 존재!');
      }
    } else {
      if (db_flag) {
        await User.updateOne(
          { _id: item._id },
          {
            $set: {
              'snsAccount.tiktok': {},
            },
          },
        );
      }
      // 사용자에게 계장연동 오류 최초 메일링을 발송
      await mailing(item, 'tiktok', 'error');
    }
  }

  // cron 리스트 확인
  let jobList;
  jobList = schedule.scheduledJobs;
  console.log('tiktokCronRegister > jobList =', jobList);
}
// 함수형태로 재사용 가능한 cron 작업 생성
async function tiktokCronJob(refresh_token, userInfo) {
  try {
    let jobList;

    // 토큰 리프레시 요청
    const tokenEndpoint = CONF.TIKTOK_API_URL + '/oauth/token/';
    const data = qs.stringify({
      client_key: CONF.TIKTOK_CLIENT_KEY,
      client_secret: CONF.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
    });
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    };
    const result = await axios.post(tokenEndpoint, data, { headers });

    // 혹시 access_token 정보가 없으면 오류 처리
    if (!result.data.access_token) {
      // cron list
      jobList = schedule.scheduledJobs;

      // 해당 사용자 cron stop
      job_tiktok[userInfo._id].cancel();

      if (db_flag) {
        await User.updateOne(
          { _id: userInfo._id },
          {
            $set: {
              'snsAccount.tiktok': {},
              // 'snsAccount.tiktokStatus': 'error',
            },
          },
        );
      }
      // 사용자에게 계장연동 오류 최초 메일링을 발송
      await mailing(userInfo, 'tiktok', 'error');
    } else {
      // 만료일자 저장
      result.data.expires_createdAt = new Date();

      // 사용자 정보 업데이트
      if (db_flag) {
        await User.updateOne(
          { _id: userInfo._id },
          {
            $set: {
              'snsAccount.tiktok.tokenInfo': result.data,
            },
          },
        );
      }
    }
  } catch (error) {
    console.error('틱톡 토큰 처리 에러! 해당 cron 정지');
    jobList = schedule.scheduledJobs;

    // 해당 사용자 cron stop
    job_tiktok[userInfo._id].cancel();

    if (db_flag) {
      await User.updateOne(
        { _id: userInfo._id },
        {
          $set: {
            'snsAccount.tiktok': {},
          },
        },
      );
    }
    // 사용자에게 계장연동 오류 최초 메일링을 발송
    await mailing(userInfo, 'tiktok', 'error');
  }
}
// 주어진 시간보다 1시간 먼저 실행되는 cron 표현식 생성
function createOneHourBeforeCronExpression(time) {
  const date = new Date(time);
  date.setHours(date.getHours() - 1); // 1시간 빼기

  // cron 표현식 생성
  const cronExpression = `${date.getMinutes()} ${date.getHours()} * * *`;
  // const cronExpression = '10 * * * * *'; // test
  return cronExpression;
}

exports.start = async (req, res) => {
  try {
    let jobList;
    jobList = schedule.scheduledJobs;

    // 혹시 기존에 작업이 있다면 삭제
    for (const [key, value] of Object.entries(jobList)) {
      jobList[key].cancel();
    }

    // 12시 실행
    job12 = schedule.scheduleJob('0 12 * * * ', async () => {
      console.log('12시 Cron job executed!');
      await facebook();
      await instagram();
      await youtube();
      await tiktokCronRegister();
    });

    // 24시 실행
    job24 = schedule.scheduleJob('0 0 * * * ', async () => {
      console.log('24시 Cron job executed!');
      await facebook();
      await instagram();
      await youtube();
      await tiktokCronRegister();
    });

    // 재시작시 기본 1회 토큰 점검
    await facebook();
    await instagram();
    await youtube();

    // 틱톡은 별도 사용자별 cron 이므로 초기 실행시 1회 실행
    await tiktokCronRegister();

    jobList = schedule.scheduledJobs;

    const data = [];
    for (const [key, value] of Object.entries(jobList)) {
      data.push(key);
    }

    return res.status(200).json({ data: data });
  } catch (error) {
    console.log(error);
    return res.status(error.status).json({ msg: error });
  }
};

exports.info = async (req, res) => {
  try {
    jobList = schedule.scheduledJobs;

    const data = [];
    for (const [key, value] of Object.entries(jobList)) {
      data.push(key);
    }

    return res.status(200).json({
      data: data,
    });
  } catch (error) {
    return res.status(error.status).json({ msg: error });
  }
};

exports.tiktokTest = async (req, res) => {
  try {
    jobList = schedule.scheduledJobs;

    await tiktokCronRegister();

    jobList = schedule.scheduledJobs;

    const data = [];
    for (const [key, value] of Object.entries(jobList)) {
      data.push(key);
    }

    return res.status(200).json({
      data: data,
    });
  } catch (error) {
    return res.status(error.status).json({ msg: error });
  }
};

exports.tiktokTestDelete = async (req, res) => {
  try {
    const { userId } = req.query;

    jobList = schedule.scheduledJobs;

    job_tiktok[userId].cancel();

    jobList = schedule.scheduledJobs;

    const data = [];
    for (const [key, value] of Object.entries(jobList)) {
      data.push(key);
    }

    return res.status(200).json({
      data: data,
    });
  } catch (error) {
    return res.status(error.status).json({ msg: error });
  }
};

exports.tiktokTestOne = async (req, res) => {
  try {
    const { refresh_token, userId, userName, userEmail, countryCode } =
      req.query;
    const userInfo = {
      _id: userId,
      userName: userName,
      userEmail: userEmail,
      countryCode: countryCode,
    };

    await tiktokCronJob(refresh_token, userInfo);

    return res.status(200).json({
      data: 'data',
    });
  } catch (error) {
    return res.status(error.status).json({ msg: error });
  }
};

exports.facebookTest = async (req, res) => {
  try {
    await facebook();

    return res.status(200).json({
      data: 'data',
    });
  } catch (error) {
    return res.status(error.status).json({ msg: error });
  }
};

exports.instagramTest = async (req, res) => {
  try {
    await instagram();
    return res.status(200).json({
      data: 'data',
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status).json({ msg: error });
  }
};

exports.youtubeTest = async (req, res) => {
  try {
    await youtube();
    return res.status(200).json({
      data: 'data',
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status).json({ msg: error });
  }
};
