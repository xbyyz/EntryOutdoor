const app = getApp()
const util = require('../../utils/util.js')
const qrcode = require('../../utils/qrcode.js')
const lvyeorg = require('../../utils/lvyeorg.js')
const outdoor = require('../../utils/outdoor.js')
const template = require('../../utils/template.js')
const cloudfun = require('../../utils/cloudfun.js')

wx.cloud.init()
const db = wx.cloud.database({})
const dbOutdoors = db.collection('Outdoors')
const dbPersons = db.collection('Persons')
const _ = db.command

Page({

  data: {
    outdoorid: null, // 活动id
    entryInfo: { //报名信息
      status: "浏览中", // 报名状态：浏览中；占坑中；替补中；已报名；领队；
      meetsIndex: -1, // 选择的集合地点，若只有一个地点则无需选择
      agreedDisclaimer: false, // 认同免责条款
      knowWay: false, // 是否认路
    },
    title: {}, // 活动主题信息，内容从数据库中读取
    route: {}, // 活动路线，由wayPoints（多个途经点）和trackFiles（多个轨迹文件）组成
    meets: [], //集合点，可多个
    brief: {}, // 活动介绍，文字加图片
    limits: {}, // 领队设定的各类限制条款

    remains: {
      //remainOccupyTime: 10 * 24 * 60, // 距离占坑截止还剩余的时间（单位：分钟）
      //remainEntryTime: 10 * 24 * 60, // 距离报名截止还剩余的时间（单位：分钟）
      occupy: {
        time: null,
        text: ""
      },
      entry: {
        time: null,
        text: ""
      },
    },

    // 同步到网站的信息
    websites: {
      lvyeorg: {
        fid: null, // 版块id
        tid: null, // 帖子id
        waitings: [], // 要同步但尚未同步的信息列表
      }
    },

    status: null, //活动状态 
    members: null, // 队员报名信息，包括:personid,基本信息（userInfo)内容从Persons数据库中读取; 报名信息（entryInfo），报名时填写
    // 还是把userinfo和outdoors信息都保存下来方便使用
    userInfo: null,
    entriedOutdoors: null, // 报名的id列表
    caredOutdoors: null, // 关注的活动id列表
    hasCared: false, // 该活动是否已经加了关注
    newChat: false, // 是否有新留言

    showPopup: false, // 分享弹出菜单
  },

  onLoad: function(options) {
    console.log(options)
    var outdoorid = null;
    if (options.outdoorid) {
      outdoorid = options.outdoorid
    } else if (options.scene) {
      console.log(options.scene)
      const scene = decodeURIComponent(options.scene)
      console.log(scene)
      outdoorid = options.scene
    }
    // 存起来，以便其他地方能回到该活动
    util.saveOutdoorID(outdoorid);

    if (app.globalData.openid == null || app.globalData.openid.length == 0) {
      app.openidCallback = (openid) => {
        app.globalData.openid = openid // 其实屁事没有，就是要等到app的onLaunch中得到openid
        this.checkLogin(outdoorid);
      }
    } else {
      this.checkLogin(outdoorid);
    }
  },

  // 处理是否登录的问题
  checkLogin: function(outdoorid) {
    if (app.globalData.hasUserInfo && app.globalData.userInfo != null) {
      this.setData({
        userInfo: app.globalData.userInfo,
      });
      this.loadInfo(outdoorid); // 这里调用 personid相关的代码
    } else {
      app.personidCallback = (personid, userInfo) => {
        if (personid != null) {
          this.setData({
            userInfo: userInfo,
          });
          this.loadInfo(outdoorid); // 这里调用 personid相关的代码
        } else {
          wx.showModal({
            title: '报名需先登录',
            content: '小程序将自动切换到“我的信息”页面，请点击“微信登录”按钮登录；然后再点击“回到最近的活动”按钮回到报名页面',
            showCancel: false,
            confirmText: "知道了",
            success: function(res) {
              wx.switchTab({
                url: '../MyInfo/MyInfo'
              })
            }
          })
        }
      }
    }
  },

  // 从数据库中装载信息
  loadInfo: function(outdoorid) {
    const self = this;
    // 这里得到活动id，读取数据库，加载各类信息
    self.data.outdoorid = outdoorid
    dbOutdoors.doc(self.data.outdoorid).get()
      .then(res => {
        self.setData({
          outdoorid: self.data.outdoorid,
          title: res.data.title,
          // route: res.data.route, 做兼容性处理了
          meets: res.data.meets,
          members: res.data.members,
          status: res.data.status,
          // brief,limits： 需要做兼容性处理，放到下面专门的函数中
        })
        self.dealOutdoorCompatibility(res) // 处理Outdoors表中数据的兼容性
        self.checkOcuppyLimitDate() // 处理占坑截止时间过了得退坑的问题

        if (res.data.meets.length <= 1) { // 若只有一个集合地点，默认设置就好了
          self.setData({
            "entryInfo.meetsIndex": 0,
          })
        }
        // 从数据库中得到自己已经报名的状态
        var index = self.findFromMembers(app.globalData.personid, self.data.members)
        if (index >= 0) {
          self.setData({
            entryInfo: self.data.members[index].entryInfo,
          })
          self.dealEntryInfoCompatibility() // 处理报名信息的兼容性
        }
      })

    // 从Person表中找到自己的信息
    dbPersons.doc(app.globalData.personid).get()
      .then(res => {
        self.data.userInfo = res.data.userInfo
        self.data.entriedOutdoors = res.data.entriedOutdoors
        self.data.caredOutdoors = res.data.caredOutdoors
        self.data.caredOutdoors.forEach((item, index) => {
          if (item.id == self.data.outdoorid)
            self.setData({
              hasCared: true, // 该活动已经加了关注
            })
        })
      })

    // 最后帮助把之前积累的信息同步到网站上
    self.postWaitings()
  },

  // 判断是否需要与网站同步
  postWaitings: function() {
    const self = this
    // 先判断本活动是否需要同步到org上
    if (self.data.websites && self.data.websites.lvyeorg.tid) {
      // 登录后，先把已有的waitings信息同步一下
      if (!app.globalData.lvyeorgLogin) { // 尚未登录，则等待登录
        app.callbackLoginLvyeorg = (res) => {
          if (res.username) {
            lvyeorg.postWaitings(self.data.outdoorid, self.data.websites.lvyeorg.tid)
          }
        }
        app.loginLvyeOrg() // 登录一下
      } else { // 登录了直接设置就好
        lvyeorg.postWaitings(self.data.outdoorid, self.data.websites.lvyeorg.tid)
      }
    }
  },

  // 处理占坑截止时间过了得退坑的问题
  checkOcuppyLimitDate: function() {
    const self = this
    if (self.data.limits.remainOccupyTime < 0) {
      self.data.members.forEach((item, index) => {
        if (item.entryInfo.status == "占坑中") {
          self.data.members.splice(index, 1)
        }
      })
      // 删完了还得存到数据库中，调用云函数写入
      cloudfun.updateOutdoorMembers(self.data.outdoorid, self.data.members, null)
    }
  },

  // 处理Outdoors表中数据的兼容性
  dealOutdoorCompatibility: function(res) {
    const self = this;
    // brief 文字加图片 
    if (res.data.brief) {
      self.setData({
        brief: res.data.brief,
      })
    }
    //limits
    console.log(res.data)
    console.log(res.data.limits)
    if (res.data.limits) {
      self.setData({
        limits: res.data.limits,
      })
    }
    // 几日活动，老存储：durings duringIndex
    if (!res.data.title.during && res.data.title.durings && res.data.title.duringIndex) {
      self.setData({
        "title.during": res.data.title.durings[res.data.title.duringIndex],
      })
    }
    // 人数限制
    console.log("res.data.limits: ")
    console.log(res.data.limits)
    if (!res.data.limits || !res.data.limits.maxPerson) {
      self.setData({
        "limits.maxPerson": false,
      })
    }
    // 是否允许空降，默认不允许
    if (!res.data.limits || !res.data.limits.allowPopup) {
      self.setData({
        "limits.allowPopup": false,
      })
    }
    // 占坑和报名截止时间
    if (!res.data.limits) {
      res.data.limits = {
        occppy: null,
        entry: null
      }
    }
    self.setData({
      "remains.occupy.time": self.calcRemainTime(self.data.title.date, res.data.limits.ocuppy),
      "remains.entry.time": self.calcRemainTime(self.data.title.date, res.data.limits.entry)
    })
    self.setData({
      "remains.occupy.text": self.buildRemainText(self.data.remains.occupy.time),
      "remains.entry.text": self.buildRemainText(self.data.remains.entry.time)
    })

    // 网站同步信息
    if (res.data.websites) {
      self.setData({
        "websites": res.data.websites,
      })
    }
    // 交通方式
    if (res.data.traffic) {
      self.setData({
        "traffic": res.data.traffic,
        "traffic.carInfo": outdoor.buildCarInfo(res.data.traffic),
      })
    }
    console.log(self.data.traffic)
    // 活动路线，增加轨迹文件
    if (res.data.route instanceof Array) { // 说明是老格式
      self.setData({
        "route.wayPoints": res.data.route, // 途经点
        "route.trackFiles": null, // 轨迹文件
      })
    } else { // 新格式直接设置
      self.setData({
        route: res.data.route,
      })
      if (!self.data.route.wayPoints) { // 防止为空
        self.setData({
          "route.wayPoints": []
        })
      }
    }
    // 微信服务通知
    if (!res.data.limits || !res.data.limits.wxnotice) {
      self.setData({
        "limits.wxnotice": template.getDefaultNotice()
      })
    }
    // chat
    self.setNewchat(res.data.chat)

    // next 

  },

  buildRemainText: function(remainMinute) {
    var remainText = "";
    if (remainMinute > 0) {
      var remainDay = Math.trunc(remainMinute / 24.0 / 60.0)
      remainMinute -= remainDay * 24 * 60
      var remainHour = Math.trunc(remainMinute / 60)
      remainMinute = Math.trunc(remainMinute - remainHour * 60)
      remainText = remainDay + "天" + remainHour + "小时" + remainMinute + "分钟"
    }
    return remainText
  },

  // 计算当前距离截止时间还剩余的时间（单位：分钟）
  // 若 limitItem 为空，则说明为不限
  calcRemainTime: function(outdoorDate, limitItem) {
    console.log(limitItem)
    if (!limitItem) {
      limitItem = {
        date: "不限",
        time: null
      }
    }
    console.log(outdoorDate)
    console.log(limitItem)
    var outdoorMinute = Date.parse(util.Ymd2Mdy(outdoorDate)) / 1000.0 / 60 // 得到活动日期的分钟时间数
    var dayCount = util.getLimitDateIndex(limitItem.date)
    console.log("dayCount:" + dayCount)
    var minute = 24 * 60; // 一天多少分钟
    console.log(limitItem.time)
    if (limitItem.time) {
      var hour_minute = limitItem.time.split(":")
      minute = minute - (parseInt(hour_minute[0]) * 60 + parseInt(hour_minute[1]))
      console.log("hour_minute:" + hour_minute)
      console.log("minute:" + minute)
    }
    minute += (dayCount - 1) * 24 * 60 // 截止时间和活动日期两者之间间隔的分钟数
    console.log("minute" + minute)
    var limitMinute = outdoorMinute - minute // 截止时间的分钟数

    var nowMinute = Date.parse(new Date()) / 1000.0 / 60
    var remainMinute = limitMinute - nowMinute

    console.log(remainMinute)
    return remainMinute
  },


  // 处理报名信息的兼容性
  dealEntryInfoCompatibility: function() {
    const self = this
    if (!self.data.entryInfo.agreedDisclaimer) { // 是否同意免责条款
      self.setData({
        "entryInfo.agreedDisclaimer": false,
      })
    }
    if (!self.data.entryInfo.knowWay) { // 是否认路
      self.setData({
        "entryInfo.knowWay": false,
      })
    }
  },

  // 把当前的信息刷新到members中，以便后续写入数据库
  // 知道了，返回index，如果找不到，返回-1
  flushToMembers: function(personid, entryInfo, members) {
    var result = -1;
    members.forEach(function(item, index) {
      if (item.personid != null && item.personid == personid) {
        item.entryInfo = entryInfo
        result = index;
      }
    })
    return result;
  },

  // 从members找到personid，并返回 index，找不到，返回-1
  findFromMembers: function(personid, members) {
    // 这里要判断一下自己当前的报名状态
    var result = -1;
    members.forEach(function(item, index) {
      if (item != null && item.personid != null && item.personid == personid) {
        result = index
      }
    })
    return result;
  },

  onPopup() {
    console.log("onPopup")
    this.setData({
      showPopup: true,
    })
  },

  closePopup() {
    console.log("closePopup")
    this.setData({
      showPopup: false,
    })
  },

  onCancelShare() {
    this.setData({
      showPopup: false,
    })
  },

  onShareAppMessage: function() {
    const self = this;
    this.closePopup()
    if (self.data.outdoorid) { // 数据库里面有，才能分享出去
      return {
        title: self.data.title.whole,
        desc: '分享活动',
        path: 'pages/EntryOutdoor/EntryOutdoor?outdoorid=' + self.data.outdoorid
      }
    }
  },

  // 分享到朋友圈
  onShare2Circle: function() {
    const self = this;
    qrcode.share2Circle(self.data.outdoorid, self.data.title.whole, false)
    this.closePopup()
  },

  // 刷新一下 entriedOutdoors 里面的内容：报名的话，把当前活动信息放到第一位；退出则要删除当前活动
  updateEntriedOutdoors: function(isQuit) {
    const self = this
    // 先保证把当前活动清除掉
    self.data.entriedOutdoors.forEach(function(item, index) {
      if (item.id == self.data.outdoorid) {
        self.data.entriedOutdoors.splice(index, 1);
      }
    })

    // 若非退出，则加到第一条
    if (!isQuit) {
      self.data.entriedOutdoors.unshift({
        id: self.data.outdoorid,
        title: self.data.title.whole
      })
    }

    // 最后更新数据库
    dbPersons.doc(app.globalData.personid).update({
      data: {
        entriedOutdoors: self.data.entriedOutdoors
      }
    })
  },

  // 报名就是在活动表中加上自己的id，同时还要在Person表中加上活动的id
  entryOutdoor: function(status, formid) {
    const self = this;
    console.log("EntryOutdoors.js in entryOutdoor fun, status is:" + JSON.stringify(status, null, 2))
    // 再判断一下是否属于 修改报名的类型，即在“占坑”和“报名”中切换
    if (self.data.entryInfo.status == "占坑中" || self.data.entryInfo.status == "报名中") {
      // 属于的话，就只更新 Outdoors表members的entryInfo信息就好
      self.setData({
        "entryInfo.status": status,
      })

      // 还是先刷新一下members
      dbOutdoors.doc(self.data.outdoorid).get()
        .then(res => {
          // 修改members中personid位置的报名信息
          for (var i = 0; i < res.data.members.length; i++) {
            if (res.data.members[i].personid == app.globalData.personid) {
              res.data.members[i].entryInfo = self.data.entryInfo
            }
          }
          self.setData({
            members: res.data.members,
          })
          // 再调用云函数写入
          cloudfun.updateOutdoorMembers(self.data.outdoorid, self.data.members, null)
          self.updateEntriedOutdoors(false)
        })
    } else { // 完全新报名，增加一条记录
      // 先从Person表中找到自己的信息
      console.log(self.data.entryInfo)
      self.setData({
        "entryInfo.status": status,
        entryInfo: self.data.entryInfo,
      })
      console.log(self.data.entryInfo)

      var member = util.createMember(app.globalData.personid, self.data.userInfo, self.data.entryInfo)
      cloudfun.pushOutdoorMember(self.data.outdoorid, member, nouse => {
        // 刷新一下队员列表
        dbOutdoors.doc(self.data.outdoorid).get()
          .then(res => {
            self.setData({
              members: res.data.members
            })
          })

        // Person表中，还要把当前outdoorid记录下来
        self.updateEntriedOutdoors(false)
      })
    }

    // 把自己的报名信息同步到网站上
    self.postEntry2Websites(false)
    // 报名后给领队发个微信模板消息
    self.postEntry2Template(formid)
  },

  // 把报名消息给领队发个微信模板消息
  postEntry2Template(formid) {
    const self = this
    let notice = self.data.limits.wxnotice
    console.log("postEntry2Template")
    // 如果领队设定活动不需要审核，则给自己发微信消息
    if (true) { // todo
      // 活动主题，领队联系方式，自己的昵称，报名状态，
      template.sendEntryMsg2Self(app.globalData.personid, this.data.title.whole, this.data.members[0].userInfo.phone, app.globalData.userInfo.nickName, this.data.entryInfo.status, this.data.outdoorid, formid)
    }

    console.log(notice)
    if (notice.accept) { // 领队设置接收微信消息
      if ((notice.entryCount > notice.alreadyCount) || (notice.fullNotice && (self.data.limit.maxPerson && self.data.members.length >= self.data.limit.personCount))) { // 前几个报名，或者接收最后一个报名，才发送微信消息
        var key = this.data.outdoorid + "." + this.data.entryInfo.personid
        var count = parseInt(wx.getStorageSync(key))
        if (!count) {
          count = 0
        }
        console.log("count:" + count)
        if (count < 1) { // 每个人只发送一次
          template.sendEntryMsg2Leader(this.data.members[0].personid, this.data.userInfo, this.data.entryInfo, this.data.title.whole, this.data.outdoorid)
          wx.setStorageSync(key, parseInt(count) + 1)
          // 发送结束，得往数据库里面加一条；还必须调用云函数
          cloudfun.addOutdoorNoticeCount(self.data.outdoorid, 1)
        }
      }
    }
  },

  // 把信息同步到网站上
  postEntry2Websites: function(isQuit) {
    const self = this
    console.log(self.data.websites)
    // 先判断活动可以同步
    if (self.data.websites && self.data.websites.lvyeorg &&
      self.data.websites.lvyeorg.keepSame || self.data.websites.lvyeorg.tid) {
      var entryMessage = lvyeorg.buildEntryMessage(self.data.userInfo, self.data.entryInfo, isQuit, false) // 构建报名信息
      console.log(entryMessage)
      console.log(app.globalData.lvyeorgLogin)
      if (app.globalData.lvyeorgLogin && self.data.websites.lvyeorg.tid) { // 登录了就直接发
        lvyeorg.postWaitings(self.data.outdoorid, self.data.websites.lvyeorg.tid, callback => {
          lvyeorg.postMessage(self.data.outdoorid, self.data.websites.lvyeorg.tid, entryMessage.title, entryMessage.message)
        })
      } else if (app.globalData.lvyeorgInfo && !app.globalData.lvyeorgLogin && self.data.websites.lvyeorg.tid) { // 注册了没登录，就登录一下
        app.callbackLoginLvyeorg = (res) => { // 设置回调
          if (res.username) {
            console.log("app.callbackLoginLvyeorg")
            lvyeorg.postWaitings(self.data.outdoorid, self.data.websites.lvyeorg.tid, callback => {
              lvyeorg.postMessage(self.data.outdoorid, self.data.websites.lvyeorg.tid, entryMessage.title, entryMessage.messageentryMessage.title, entryMessage.message)
            })
          } else if (res.error) { // 登录失败也记录到waitings中 // todo 标题先不加了
            lvyeorg.add2Waitings(self.data.outdoorid, entryMessage.message)
          }
        }
        app.loginLvyeOrg() // 登录
      } else { // 没注册就记录到waitings中
        lvyeorg.add2Waitings(self.data.outdoorid, entryMessage.message)
      }
    }
  },

  // 替补
  tapBench: function(e) {
    this.doEntry("替补中", e.detail.formId)
  },

  // 占坑
  tapOcuppy: function(e) {
    this.doEntry("占坑中", e.detail.formId)
  },

  // 报名
  tapEntry: function(e) {
    this.doEntry("报名中", e.detail.formId)
  },

  // 替补、占坑、报名，用同一个函数，减少重复代码
  doEntry(status, formid) {
    // console.log(status) 
    // console.log(formid) 
    if (this.data.entryInfo.status != status) {
      this.entryOutdoor(status, formid)
    } else {
      template.savePersonFormid(this.data.personid, formid, null)
    }
  },

  // 退出
  tapQuit: function() {
    console.log("tapQuit")
    const self = this;
    outdoor.removeMember(self.data.outdoorid, app.globalData.personid, members => {
      // 删除Persons表中的entriedOutdoors中的对应id的item
      self.updateEntriedOutdoors(true)
      // 退出后还可以继续再报名
      self.setData({
        "entryInfo.status": "浏览中",
        members: members,
      })
    })
    // 退出信息也要同步到网站
    self.postEntry2Websites(true)
  },

  // 查看报名情况，同时可以截屏保存起来
  printOutdoor() {
    // 导航到 printOutdoor页面
    const self = this;
    var isLeader = "&isLeader=false";
    if (self.data.entryInfo.status == "领队") {
      isLeader = "&isLeader=true";
    }
    wx.navigateTo({
      url: "../AboutOutdoor/PrintOutdoor?outdoorid=" + self.data.outdoorid + isLeader
    })
  },

  chatOutdoor() {
    const self = this;
    wx.navigateTo({
      url: "../AboutOutdoor/ChatOutdoor?outdoorid=" + self.data.outdoorid,
      complete(res) {
        self.setData({
          newChat: false,
        })
      }
    })
  },


  // 页面相关事件处理函数--监听用户下拉动作  
  onPullDownRefresh: function() {
    console.log("onPullDownRefresh")
    const self = this
    wx.showNavigationBarLoading();
    // 主要就刷新队员和留言信息
    dbOutdoors.doc(self.data.outdoorid).get().then(res => {
      self.setData({
        members: res.data.members,
      })
      self.setNewchat(res.data.chat)
      wx.hideNavigationBarLoading();
      wx.stopPullDownRefresh();
    })
  },

  // 判断是否有新留言
  setNewchat(chat) {
    if (chat && chat.messages) {
      var count = 0
      if (chat.seen && chat.seen[app.globalData.personid]) {
        count = chat.seen[app.globalData.personid]
      }
      this.setData({
        newChat: chat.messages.length > count,
      })
    }
  },

  clickMeets: function(e) {
    console.log(e)
    this.setData({
      "entryInfo.meetsIndex": parseInt(e.target.dataset.name),
    })
  },

  // 选择或改变集合地点选择
  changeMeets: function(e) {
    const self = this;
    self.setData({
      "entryInfo.meetsIndex": parseInt(e.detail),
    })
  },

  // 查看集合地点的地图设置，并可导航
  lookMeetMap() {
    const self = this
    const index = self.data.entryInfo.meetsIndex
    // 选中了集合地点，并且有经纬度，才开启选择地图
    if (index >= 0 && self.data.meets[index].latitude) {
      var message = "同意授权“使用我的地理位置”才能调用微信地图；小程序不会记录您的位置，请放心"
      util.authorize("userLocation", message, res => {
        const latitude = self.data.meets[index].latitude
        const longitude = self.data.meets[index].longitude
        wx.openLocation({
          latitude,
          longitude,
          scale: 18
        })
      })
    }
  },

  // 勾选同意免责条款
  checkDisclaimer: function(e) {
    const self = this;
    self.setData({
      "entryInfo.agreedDisclaimer": !self.data.entryInfo.agreedDisclaimer,
    })
  },

  // 勾选是否认路
  checkKnowWay: function(e) {
    const self = this;
    console.log(self.data.entryInfo.knowWay)
    self.setData({
      "entryInfo.knowWay": !self.data.entryInfo.knowWay,
    })
  },

  // 关注活动
  careOutdoor: function() {
    // 关注活动，就是往Persons表中做一下记录
    const self = this;
    if (!self.data.hasCared) {
      self.data.caredOutdoors.unshift({
        id: self.data.outdoorid,
        title: self.data.title.whole
      })
      dbPersons.doc(app.globalData.personid).update({
        data: {
          caredOutdoors: self.data.caredOutdoors
        }
      }).then(res => {
        self.setData({
          hasCared: true,
        })
      })
    }
  },

  //取消关注
  cancelCare: function() {
    const self = this;
    if (self.data.hasCared) {
      self.data.caredOutdoors.forEach((item, index) => {
        if (item.id == self.data.outdoorid) {
          self.data.caredOutdoors.splice(index, 1)
        }
      })
      dbPersons.doc(app.globalData.personid).update({
        data: {
          caredOutdoors: self.data.caredOutdoors
        }
      }).then(res => {
        self.setData({
          hasCared: false,
        })
      })
    }
  },

  // 跳转到“订阅领队”页面
  clickLeader() {
    wx.navigateTo({
      url: '../EntryOutdoor/SubscribeLeader?leaderid=' + this.data.members[0].personid,
    })
  },

  // 回到首页
  toMainpage: function() {
    wx.switchTab({
      url: "../MyOutdoors/MyOutdoors",
    })
  },

})