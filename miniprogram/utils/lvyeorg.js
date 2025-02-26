// 把和lvyeorg对接的具体实现代码都放到这里来
const app = getApp()
const qrcode = require('./qrcode.js')
const util = require('./util.js')
const cloudfun = require('./cloudfun.js')
const promisify = require('./promisify.js')

wx.cloud.init()
const db = wx.cloud.database()
const dbOutdoors = db.collection('Outdoors')
 
const LvyeOrgURL = 'https://www.lvye.net/panpa/'

// 返回登录org网站所需要的token
const getToken = async() => {
  let res = await promisify.login()
  if (res.code) {
    var token = wx.getStorageSync("LvyeOrgToken")
    console.log(token)
    try {
      let resp = await promisify.request({
        url: LvyeOrgURL + 'get_token.php',
        method: 'POST',
        header: {
          "content-type": "application/x-www-form-urlencoded"
        },
        data: {
          token: token,
          code: res.code,
        }
      })
      console.log('Get lvye token: ', resp);
      var resp_dict = resp.data;
      if (resp_dict.err_code == 0) {
        console.log(resp_dict.data.token);
        return resp_dict.data.token
      } else {
        console.log(resp_dict.data.err_msg)
      }
    } catch (err) {
      console.log(err)
    }
  }
  return 0
}

// 登录绿野网站
const login = async(username, password) => {
  console.log("lvyeorg.js login()")
  console.log(username)
  console.log(password)

  let token = await getToken()
  if (!token) {
    return {
      error: "绿野ORG挂了",
      username: ""
    }
  } else {
    console.log("get token ok, is: " + token)
    wx.setStorageSync('LvyeOrgToken', token)

    try {
      let resp = await promisify.request({
        url: LvyeOrgURL + "login.php",
        method: "post",
        header: {
          "content-type": "application/x-www-form-urlencoded"
        },
        data: {
          token: token,
          username: encodeURI(username),
          password: password
        }
      })
      console.log("lvyeorg login,res:", resp)
      var resp_dict = resp.data
      if (resp_dict.err_code == 0) {
        wx.setStorageSync('LvyeOrgToken', resp_dict.data.token) // 这里必须把token存起来
        return {
          username: username
        }
      } else {
        let error = await getError(resp)
        console.log("lvyeorg login error:", error)
        return {
          error: error,
          username: ""
        }
      }
    } catch (err) {
      return {
        error: "绿野ORG挂了",
        username: ""
      }
    }
  }
}

// 退出登录
const logout = async() => {
  var token = wx.getStorageSync("LvyeOrgToken")
  console.log(token)

  await promisify.request({
    url: LvyeOrgURL + 'logout.php',
    method: 'POST',
    header: {
      "content-type": "application/x-www-form-urlencoded"
    },
    data: {
      token: token,
    }
  })
}

// 注册新账号
const register = async(email, username, password1, password2) => {
  if (!username) {
    showModal("账号不能为空");
    return null
  }
  if (!email) {
    showModal("请输入正确的邮箱地址");
    return null
  }
  if (!password1 || !password2 || !(password1 == password2)) {
    showModal("密码不能为空，且两次密码必须相同");
    return null
  }

  var token = wx.getStorageSync("LvyeOrgToken")
  console.log(token)
  let resp = await promisify.request({
    url: LvyeOrgURL + "register.php",
    method: "post",
    header: {
      "content-type": "application/x-www-form-urlencoded"
    },
    data: {
      token: token,
      username: username,
      password: password1,
      email: email
    }
  })

  console.log(resp);
  var resp_dict = resp.data;
  if (resp_dict.err_code == 0) {
    // wx.setStorageSync('LvyeOrgToken', resp_dict.data.token)
    // 注册成功后，把信息写入Person表，登录org，告知发帖时间限制，退回到上一页面
  } else {
    showErrorModel(resp);
  }
}

// 上传一张照片
const uploadOneImage = async(outdoorid, cloudPath) => {
  console.log("uploadOneImage fun")
  console.log("cloudPath is:" + cloudPath)
  // 步骤1：从 cloud中下载图片到临时文件
  let res = await wx.cloud.downloadFile({
    fileID: cloudPath,
  })
  console.log(res.tempFilePath)
  var token = wx.getStorageSync("LvyeOrgToken")
  console.log(token)
  // 步骤2：上传到 org网站，得到 file_url 和 aid
  let resp = await promisify.uploadFile({
    url: LvyeOrgURL + 'add_image.php',
    filePath: res.tempFilePath,
    name: "myfile",
    formData: {
      token: token,
    }
  })

  console.log(resp);
  var resp_dict = JSON.parse(resp.data)
  console.log(resp_dict)
  if (resp_dict.err_code == 0) {
    console.log(resp_dict.data.file_url)
    console.log("uploadOneImage OK, url is: " + resp_dict.data.aid)
    return ({
      aid: resp_dict.data.aid,
      url: resp_dict.data.file_url
    })
  } else {
    logError(resp)
  }
  return resp_dict
}

// 上传二维码
const uploadQrCode = async(outdoorid) => {
  console.log("uploadQrCode, outdoorid is:" + outdoorid)
  let qrCode = await qrcode.getCloudPath(outdoorid)
  console.log("qrCode is:" + qrCode)
  let res = await uploadOneImage(outdoorid, qrCode)
  console.log("uploadQrCode, res is:", res)
  return res
}

// 上传活动图片
const uploadImages = async(outdoorid, pics) => {
  console.log("uploadImages fun")
  console.log("pics are: ", pics)
  var aids = []
  for (let i in pics) {
    var res = await uploadOneImage(outdoorid, pics[i].src)
    aids.push(res.aid)
  }
  return aids
}

// 这里确定活动应发布的版面 
//  67: 周末户外活动; 90：周末休闲活动； 91:远期自助旅游; 93：技术小组
const chooseForum = (title, isTesting) => {
  console.log(title)
  console.log(isTesting)

  var fid = 67 // 默认户外
  if (isTesting) {
    fid = 93 // 技术小组版 
  } else {
    var fid = 67 // 默认户外
    var day1 = new Date(title.date); // 活动日期
    var day2 = new Date(); // 当前日期
    var dayCount = (day1 - day2) / (1000 * 60 * 60 * 24) // 差了几天
    if (dayCount > 30) { // 30天算远期
      fid = 91
    } else if (title.loaded == "休闲" || title.level <= 0.8) {
      fid = 90
    } else if (title.loaded == "重装" || title.level >= 1.0) {
      fid = 67
    }
  }
  return fid
}

// 判断版面id是否为测试类活动
const isTestForum = (fid) => {
  return fid == 93 ? true : false
}

const NL = "\r\n"
const NL2 = "\r\n\r\n" // "&#10&#10" // "\r\n\r\n"// "&lt;br&gt;&lt;br&gt;" // "<br><br>" // 换行符

// 按照集合地点分组
const groupMembersByMeets = (meets, members) => {
  var meetMembers = []
  for (var i = 0; i < meets.length; i++) {
    meetMembers[i] = new Array();
  }
  // 遍历所有队员 
  for (var j = 0; j < members.length; j++) {
    meetMembers[members[j].entryInfo.meetsIndex].push(members[j])
  }
  return meetMembers
}

// 构建队员名单，按照集合地点分组，隐藏队员号码
const buildMembersMessage = (meets, members) => {
  var message = "活动名单如下：" + NL
  var meetMembers = groupMembersByMeets(meets, members)
  meetMembers.forEach((item, index) => {
    message += "第" + (index + 1) + "）集合地点：" + meets[index].place + "，活动" + meets[index].date + " " + meets[index].time + NL
    meetMembers[index].forEach((citem, cindex) => {
      var result = buildEntryMessage(meetMembers[index][cindex].userInfo, meetMembers[index][cindex].entryInfo, false, false, true)
      message += result.message + NL
    })
    message += NL
  })
  message += NL
  return message
}

// 构建活动信息，以便发布活动信息到网站 
const buildOutdoorMesage = (data, first, modifys, addMessage, allowSiteEntry) => {
  var message = "（以下内容由“户外报名”小程序同步发出）" + NL2
  if (addMessage && addMessage.length > 0) {
    message += addMessage + NL2
  }

  // 活动当前状态
  if (first || modifys.status) {
    message += "活动当前状态：" + NL + data.status + NL2
    if (data.status == "已成行") {
      // 活动人数限制xx人，现有多少人
      if (data.limits && data.limits.maxPerson) {
        message += "活动人数：限" + data.limits.personCount + "人" + NL
        message += "已报名：" + (data.members.length + data.addMembers.length) + "人"
      } else {
        message += "活动人数不限人数" + NL
      }
      message += NL + buildMembersMessage(data.meets, data.members)
      message += NL
    }
  }

  // 活动介绍
  if (first || modifys.brief) {
    message += "活动介绍：" + NL + data.brief.disc + NL2
  }

  // 活动基本信息
  if (first || modifys.title) {
    // 领队，联系方式
    message += "领队：" + data.leader.userInfo.nickName + " " + util.changePhone(data.leader.userInfo.phone) + NL2
    // 活动时间：
    message += "活动时间：" + data.title.date + "（" + util.getDay(data.title.date) + "）" + NL2
    // 活动地点：
    message += "活动地点：" + data.title.place + NL2
    // 活动强度
    message += "活动强度：累计上升" + data.title.addedUp + "00米，累计距离" + data.title.addedLength + "公里（强度值：" + data.title.level + "）" + NL2
    // 活动负重
    message += "活动性质：" + data.title.loaded + NL2
  }

  // 集合时间及地点
  if (first || modifys.meets) {
    message += "集合时间及地点：" + NL
    data.meets.forEach((item, index) => {
      message += "第" + (index + 1) + "集合地点：" + (item.date ? item.date : '当天') + " " + (item.time ? item.time : ' ') + " " + item.place + NL
    })
    message += NL
  }

  // 活动路线
  if ((first || modifys.route) && data.route.wayPoints) {
    message += NL + "活动路线及行程安排：" + NL
    data.route.wayPoints.forEach((item, index) => {
      message += (index + 1) + "） " + (item.date ? item.date : '当天') + " " + (item.time ? item.time : ' ') + " " + item.place + NL
    })
    message += NL
  }

  // 附加队员
  if ((first || modifys.addMembers) && data.addMembers.length > 0) {
    message += NL + "为以下队员代报名如下（责任由队员自负）：" + NL
    for (var i in data.addMembers) {
      message += NL + data.addMembers[i] + NL
    }
    message += NL
  }

  // 交通及费用 
  if (first || modifys.traffic) {
    message += NL + "交通方式及费用：" + NL
    message += data.traffic.mode
    message += "，" + data.traffic.cost
    if (data.traffic.cost != "免费") {
      message += "，" + data.traffic.money + "元，以实际发生为准"
    }
    if (data.traffic.mode != "公共交通" && data.traffic.car) {
      message += NL + "车辆信息：" + data.traffic.car.brand
      if (data.traffic.mode == "自驾" && data.traffic.car.color) {
        message += "，" + data.traffic.car.color
      }
      if (data.traffic.car.number) {
        message += "，车牌尾号：" + data.traffic.car.number
      }
    }
    message += NL2
  }

  // 人员限制/体力要求/是否允许空降/截止时间
  if (first || modifys.limits) {
    if (data.limits && data.limits.maxPerson) {
      message += "活动人数：限" + data.limits.personCount + "人" + NL
    }
    if (data.limits && data.limits.allowPopup) {
      message += "本活动允许空降" + NL
    } else {
      message += "本活动不允许空降" + NL
    }
    // 占坑/报名截止时间
    if (data.limits && data.limits.ocuppy) {
      if (data.limits.ocuppy.date == "不限") {
        data.limits.ocuppy.date = "当天"
      }
      message += "占坑截止时间：活动" + data.limits.ocuppy.date + " " + data.limits.ocuppy.time + NL
    }
    if (data.limits && data.limits.entry) {
      if (data.limits.entry.date == "不限") {
        data.limits.entry.date = "当天"
      }
      message += "报名截止时间：活动" + data.limits.entry.date + " " + data.limits.entry.time + NL
    }
    // 体力要求
    if (data.title.level >= 1.0) {
      message += NL + "体力要求：要求报名人员近期应参加过强度值不小于" + data.title.level + "的活动，体力能满足本活动要求。" + NL
    }

    // 装备要求
    if (data.limits && data.limits.equipments) {
      message += NL + "活动装备要求"
      message += NL + "必须有的装备："
      data.limits.equipments.mustRes.forEach((item, index) => {
        message += item + "，"
      })
      message += NL + "可以有的装备："
      data.limits.equipments.canRes.forEach((item, index) => {
        message += item + "，"
      })
      message += NL + "不能有的装备："
      data.limits.equipments.noRes.forEach((item, index) => {
        message += item + "，"
      })
      message += NL
    }
  }

  // 注意事项和免责条款
  if (first || modifys.disclaimer) {
    if (data.limits && data.limits.disclaimer) {
      message += NL + "注意事项和免责声明：" + NL
      message += data.limits.disclaimer + NL
    }
  }

  // 报名须知：请微信扫描二维码，登录小程序报名； 贴上二维码
  message += buildEntryNotice(data.websites.lvyeorg.qrcodeUrl, first, allowSiteEntry)

  return message
}

// 构建报名须知
// qrcode: 报名二维码
// first：是否为活动首帖（发布帖）
// allowSiteEntry：是否允许网站跟帖报名
const buildEntryNotice = (qrcode, first, allowSiteEntry) => {
  var message = NL
  var qrcodeMsg = "[url=" + qrcode + "]活动二维码[/url]"
  if (first) { // 发布活动时的报名信息
    message += NL + "报名须知：请到帖子末尾，用微信扫描二维码，登录小程序报名。" + NL
    message += "若看不到二维码图片，请点击这里查看并微信扫码：" + qrcodeMsg + NL
  } else { // 活动内容修改时的报名信息
    message += NL + "报名须知：请点击这里 " + qrcodeMsg + "，用微信扫描二维码，登录小程序报名。" + NL
    message += "或者回到帖子一楼扫描二维码报名。" + NL
  }

  if (!allowSiteEntry) { // 用当前活动表的设置
    message += "为方便领队汇总名单和微信消息通知，本活动不接受网站直接跟帖报名，敬请留意。" + NL
  }
  return message
}

// 构建网站报名信息; isQuit:是否为退出活动； isPrint：是否为集中打印名单时调用
const buildEntryMessage = (userInfo, entryInfo, isQuit, selfQuit, isPrint) => {
  console.log("lvyeorg.buildEntryMessage()")
  console.log(userInfo)
  var message = ""
  var title = ""
  if (!isPrint) {
    message += "（本内容由“户外报名”小程序自动发出，与发帖人无关；相应责权由“" + userInfo.nickName + "”承担）\r\n"
  }
  if (isQuit) {
    var temp = userInfo.nickName + " 因故退出活动，抱歉！"
    if (!selfQuit) {
      temp = userInfo.nickName + " 因故被领队清退"
    }
    message += temp
    title += temp
  } else {
    // 昵称/性别/电话（隐藏中间三位）/认路情况/同意免责/集合地点（报名状态）
    var temp = userInfo.nickName + "/" + userInfo.gender + "/"

    // 隐藏手机号码中间三位
    var phone = util.hidePhone(userInfo.phone.toString());
    var knowWay = entryInfo.knowWay ? "认路" : "不认路"
    temp += phone + "/" + knowWay + "/已同意免责条款/"
    if (!isPrint) {
      temp += "第" + (entryInfo.meetsIndex + 1) + "集合点"
    }
    temp += "（" + entryInfo.status + "）"

    if (!isPrint) { // 集中打印就不要标注为“代报名”了
      message += "代报名："
    }
    message += temp
    title += temp
  }
  return {
    title: title,
    message: message
  }
}

// 构建留言信息文本
const buildChatMessage = (chat) => {
  console.log("lvyeorg.buildChatMessage()")
  console.log(chat)
  var message = "（本内容由“户外报名”小程序自动发出，与发帖人无关；相应责权由“" + chat.who + "”承担）\r\n"
  message += chat.msg
  return {
    title: chat.msg,
    message: message
  }
}

// 发布活动，成功返回帖子id（tid）
const addThread = async(outdoorid, data, fid) => {
  console.log("lvyeorg.addThread()")
  console.log("fid:" + fid)
  var temp = []
  let resAids = await uploadImages(outdoorid, data.brief.pics, temp)
  console.log("resAids is:", resAids)

  let resQrCode = await uploadQrCode(outdoorid)
  console.log("resQrCode is:", resQrCode)

  resAids.push(resQrCode.aid)
  console.log("图片地址：" + resQrCode.url)
  data.websites.lvyeorg.qrcodeUrl = resQrCode.url // 记录下来

  var message = buildOutdoorMesage(data, true, null, "", data.websites.lvyeorg.allowSiteEntry) // 构建活动信息
  var token = wx.getStorageSync("LvyeOrgToken")
  console.log("token:", token)

  try {
    // 发帖
    let resp = await promisify.request({
      url: LvyeOrgURL + "add_thread.php",
      method: "POST",
      header: {
        "content-type": "application/x-www-form-urlencoded"
      },
      data: {
        token: token,
        fid: fid,
        subject: data.title.whole,
        message: message,
        aid_list: resAids,
      }
    })

    console.log("resp:", resp) // resp.data.data.tid 帖子id；resp.data.data.pid 跟帖id post id
    var resp_dict = resp.data
    if (resp_dict.err_code == 0) {
      wx.showToast({title: 'ORG发帖成功'})
      data.websites.lvyeorg.tid = resp.data.data.tid // 帖子id 
      data.websites.lvyeorg.fid = fid // 版面id 也记录下来
      cloudfun.opOutdoorItem(outdoorid, "websites", data.websites, "")
      return resp.data.data.tid
    }
    // 最恐惧的在这里：请求成功，但绿野org后台出错，帖子有了，但tid没有
    else if (resp.statusCode == 200) {
      wx.showModal({
        title: '同步绿野ORG异常',
        content: "可能已发帖到绿野ORG网站，但得不到帖子ID，后续信息无法同步，请联系小程序作者解决。",
        showCancel: false,
        confirmText: "知道了",
      })
    } else if (resp_dict.err_code != 0) { // 发帖失败了
      let error = await getError(resp)
      wx.showModal({
        title: '同步绿野ORG失败',
        content: '原因是：' + error + "。\r\n点击“再试一次”则再次尝试同步，点击“以后再发”则在您“保存修改”或再次进入本活动页面时重发。",
        confirmText: "再试一次",
        cancelText: "以后再发",
        async success(res) {
          if (res.confirm) {
            console.log('用户点击确定')
            await addThread(outdoorid, data, fid) // 立刻重发
          } else if (res.cancel) {
            console.log('用户点击取消') // 取消则“保存修改”或再次进入本活动页面时重发
          }
        }
      })
    }
  } catch (err) {
    console.log(err)
    wx.showModal({
      title: '同步绿野ORG失败',
      content: '原因是：' + err.toString() + "。可进入“附加设置”--“户外网站同步”页面手动重发",
      showCancel: false,
      confirmText: "知道了",
    })
  }
}

// 即时发布一条消息到绿野org网站，发布失败则记录到数据库中
const postMessage = async(outdoorid, tid, title, message) => {
  console.log("const postMessage")
  console.log(outdoorid)
  console.log(tid)
  console.log(message)
  var token = wx.getStorageSync("LvyeOrgToken")

  let resp = await promisify.request({
    url: LvyeOrgURL + "add_post3.php",
    method: "POST",
    header: {
      "content-type": "application/x-www-form-urlencoded"
    },
    data: {
      token: token,
      tid: tid,
      subject: title, // 
      message: encodeURI(message),
    }
  })

  console.log("跟帖成功：", resp)
  var resp_dict = resp.data;
  if (resp_dict.err_code == 0) {
    wx.showToast({
      title: 'ORG同步成功',
    })
  } else {
    let error = await getError(resp)
    add2Waitings(outdoorid, message)
  }
}

// 把未发布出去的信息加到waitings中
const add2Waitings = (outdoorid, message) => {
  console.log("lvyeorg.add2Waitings()", outdoorid, message)
  cloudfun.opOutdoorItem(outdoorid, "websites.lvyeorg.waitings", message, "push")
}

// 同步绿野org网站等待要发送的信息
const postWaitings = async(tid, waitings) => {
  console.log("lvyeorg.postWaitings()")
  console.log(tid)
  console.log(waitings.length)
  while (waitings.length > 0) {
    var waiting = waitings.shift()
    await postOneWaiting(tid, waiting)
    console.log(waitings.length)
  }
}

// 发一条等待发布的信息
const postOneWaiting = async(tid, waiting) => {
  console.log("lvyeorg.postOneWaiting()")
  console.log(tid)
  console.log(waiting)
  var token = wx.getStorageSync("LvyeOrgToken")
  console.log(token)

  return await promisify.request({
    url: LvyeOrgURL + "add_post.php",
    method: "POST",
    header: {
      "content-type": "application/x-www-form-urlencoded"
    },
    data: {
      token: token,
      tid: tid,
      message: encodeURI(waiting),
    }
  })
}

// 加载跟帖内容
const loadPosts = async(tid, begin) => {
  console.log("loadPosts()")
  console.log(begin)
  var page = {
    size: 100,
    index: 0
  }
  if (begin > 50) {
    page.size = begin
    page.index = 1
  }
  var token = wx.getStorageSync("LvyeOrgToken")
  let resp = await promisify.request({
    url: LvyeOrgURL + "get_post_detail.php",
    method: "post",
    header: {
      "content-type": "application/x-www-form-urlencoded"
    },
    data: {
      token: token,
      tid: tid,
      page_size: page.size,
      page_index: page.index,
    }
  })

  console.log("get_post_detail: ", resp)
  let posts = resp.data.data.post_list
  if (posts) {
    console.log(posts)
    if (page.index == 0) { // 只取一部分
      posts = posts.slice(begin, posts.length);
    }
  }
  return posts
}

// 得到绿野org网站反馈的错误信息
const getError = async(resp) => {
  if (resp.data.err_code != 0 && resp.data.err_msg) {
    console.log(resp.data.err_msg)
    return resp.data.err_msg
  } else {
    console.log(resp);
    var token = wx.getStorageSync("LvyeOrgToken")
    console.log(token)
    let resp = await promisify.request({
      url: LvyeOrgURL + 'report_error.php',
      method: 'POST',
      header: {
        "content-type": "application/x-www-form-urlencoded"
      },
      data: {
        token: token,
        error_log: resp.data,
        svr_url: LvyeOrgURL,
      }
    })
    console.log("getError:", resp.data.err_msg);
    return resp.data.err_msg
  }
}

// 日志输出绿野org网站反馈的错误信息
const logError = async(resp) => {
  let error = await getError(resp)
  console.log(error)
}

// 弹窗绿野org网站反馈的错误信息
const showErrorModel = async(resp) => {
  let error = await getError(resp)
  showModal(error)
}

// 弹窗显示错误信息
const showModal = (error) => {
  wx.showModal({
    title: "绿野ORG错误提示",
    content: error,
    showCancel: false,
    confirmText: "知道了"
  });
}

module.exports = {
  // getToken: getToken, // 得到token
  login: login, // 登录
  logout: logout, // 退出登录
  register: register, // 注册

  addThread: addThread, // 发帖
  buildOutdoorMesage: buildOutdoorMesage, // 构造活动信息
  buildEntryMessage: buildEntryMessage, // 构造报名信息
  buildEntryNotice: buildEntryNotice, // 构造报名须知
  buildChatMessage: buildChatMessage, // 构造留言信息
  postMessage: postMessage, // 跟帖
  add2Waitings: add2Waitings, // 往waiting中增加一条信息
  postWaitings: postWaitings, // 把正在等待发布的信息发布出去

  loadPosts: loadPosts, // 从帖子中读取跟帖
  isTestForum: isTestForum, // 判断fid是否属于测试帖
  chooseForum: chooseForum, // 选择论坛

  // 处理错误信息
  getError: getError,
  logError: logError,
  showErrorModel: showErrorModel,

  NL: NL, // const 
}