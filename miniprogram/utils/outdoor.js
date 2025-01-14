const app = getApp()

const odtools = require('./odtools.js')
const util = require('./util.js')
const template = require('./template.js')
const cloudfun = require('./cloudfun.js')
const lvyeorg = require('./lvyeorg.js')
const person = require('./person.js')

wx.cloud.init()
const db = wx.cloud.database({}) 
const dbOutdoors = db.collection('Outdoors')
const dbPersons = db.collection('Persons')
const _ = db.command 

// 创建函数，使用者必须： var od = new outdoor.OD() 来获得活动对象，并设置默认值
// 内存中的对象，为最新格式，和界面表现内容； 从数据库中load时，应注意做兼容性处理
function OD() {
  this.outdoorid = ""
  this.title = { // 活动标题，通过下面子项随时自动生成；
    whole: "", // 自动生成，也存起来
    place: "", // String; 地点描述。必填
    date: "", //必填。util.formatDate(util.nextDate(new Date(), 5)), //Date; 活动日期，能自动判断出：周六/周日/非周末; 默认活动日期为：当天的五天后
    during: "一日", // 默认为一日活动
    // duringIndex: 0, // +1 为活动天数
    loaded: "轻装", // 枚举型：轻装、重装、休闲装
    level: 1.0, //自动生成； Float，活动强度，自动计算得到，计算公式：sqrt(addedLength* addedUp/ 100)
    addedLength: 10, //Int，累积距离，单位：公里，最小值1
    addedUp: 10, //Int，累积上升，单位：百米，最小值1
    adjustLevel: 100, // 活动强度调节系数 100%意味着不调节
  }
  this.route = { // 活动路线，包括途经点和轨迹文件
    wayPoints: [],
    trackFiles: [],
  }
  this.meets = [] //集合点，可加多个
  this.traffic = {} // 交通方式
  this.members = [] // 已报名成员（含领队）
  this.addMembers = [] // 未通过小程序报名，领队添加的“附加队员”
  this.aaMembers = [] // 需要参与A费用的退出队员
  this.brief = { // 活动简要介绍，分为文字和图片（多张）
    disc: "领队有点懒，什么也没介绍",
    pics: [], // {src:string} 云存储路径
  }
  this.limits = { // 领队设置的活动限定条件
    disclaimer: "", //免责条款
    allowPopup: false, // 是否允许空降
    maxPerson: false, // 是否限制人数
  }
  this.chat = {
    messages: []
  } // 必须先把数组结构定义出来，这样后面保存才不会把数组变对象（坑死人的微信云数据库）
  this.leader = null // 领队，save时确定，或者领队转让时修改
  this.status = "拟定中" // 活动本身的状态，分为：拟定中，已发布，已成行，报名截止，已取消

  // 同步到网站的信息
  this.websites = odtools.getDefaultWebsites()
}

// 根据id从数据库中装载活动内容 
OD.prototype.load = async function(outdoorid) {
  console.log("OD.prototype.load()", outdoorid)
  try{
    let res = await dbOutdoors.doc(outdoorid).get()
    res.data.outdoorid = res.data._id
    this.copy(res.data) // 处理Outdoors表中数据的兼容性
    // 判断处理websites中的信息
    this.postWaitings()
    // 处理占坑队员（移除或提醒）
    this.dealOcuppy()
    console.log("return true")
    return true
  } catch(e){
    console.log("e",e)
    return false
  }
}

// 移除或提醒占坑队员 
OD.prototype.dealOcuppy = async function() {
  console.log("OD.prototype.dealOcuppy()")
  // 判断处理占坑过期的问题
  var remainTime = this.title.date ? odtools.calcRemainTime(this.title.date, this.limits.ocuppy, true) : 60 * 24 * 7
  console.log("remainTime：", remainTime)
  if (remainTime < 0) {
    this.members = await odtools.removeOcuppy(this.outdoorid)
  } else if (remainTime < 60 * 8) { // 不够八小时就给占坑队员发消息
    await odtools.remindOcuppy(this)
  }
}

// 加载活动时，原样拷贝活动，并处理兼容性问题 
OD.prototype.copy = function(od) {
  console.log("OD.prototype.copy()")
  this.outdoorid = od.outdoorid
  this.title = od.title
  this.title.adjustLevel = this.title.adjustLevel ? this.title.adjustLevel : 100
  this.meets = od.meets
  this.members = od.members
  // 设置领队，顺序：od中保存的、第一个队员、默认的（null）
  this.leader = od.leader ? od.leader : od.members[0]
  this.addMembers = od.addMembers ? od.addMembers : this.addMembers
  this.aaMembers = od.aaMembers ? od.aaMembers : this.aaMembers
  
  // brief 文字加图片 
  this.brief = od.brief ? od.brief : this.brief

  //limits
  console.log("limits: ")
  console.log(od.limits)
  this.limits = od.limits ? od.limits : this.limits
  // 微信服务通知，没有的话需要取默认值
  if (!this.limits.wxnotice) {
    this.limits.wxnotice = template.getDefaultNotice()
  }

  // 几日活动，老存储：durings duringIndex
  if (!od.title.during && od.title.durings && od.title.duringIndex) {
    this.title.during = od.title.durings[od.title.duringIndex]
  }

  // 网站同步信息
  this.websites = od.websites ? od.websites : this.websites

  // 交通方式
  this.traffic = od.traffic ? od.traffic : this.traffic
  this.traffic.carInfo = odtools.buildCarInfo(this.traffic)
  this.traffic.costInfo = odtools.buildCostInfo(this.traffic)
  console.log(this.traffic)

  // 活动路线，增加轨迹文件
  if (od.route instanceof Array) { // 说明是老格式
    this.route.wayPoints = od.route ? od.route : this.route.wayPoints // 途经点
  } else { // 新格式直接设置
    this.route = od.route ? od.route : this.route
  }
  this.route.wayPoints = this.route.wayPoints ? this.route.wayPoints : [] // 防止为空
  this.route.trackFiles = this.route.trackFiles ? this.route.trackFiles : [] // 轨迹文件

  this.chat = od.chat ? od.chat : this.chat
  this.chat.messages = this.chat.messages ? this.chat.messages : [] // 设置数组类型
  this.QcCode = od.QcCode
  this.pay = od.pay ? od.pay : this.pay

  // 增加对活动状态的判断，例如是否进行中，是否已结束等
  this.checkStatus(od.status)
  
  // 活动中拍摄上传的照片
  this.photos = od.photos ? od.photos:{}
  this.photocount = Object.keys(this.photos).length

  this.operations = od.operations && od.operations.length>0 ? od.operations:null

  // next 

}

// 判断处理活动状态
OD.prototype.checkStatus = function (status) {
  console.log("OD.prototype.checkStatus()", status)
  this.status = status
  if (this.status != "拟定中" || this.status != "已取消") { // 拟定中或已取消的活动，不做时间线的判断
    if (new Date() > new Date(this.title.date + "," + this.meets[0].time)) {
      this.status = "进行中"
      var days = odtools.Durings.indexOf(this.title.during) 
      var endDay = new Date(this.title.date + ",24:00")
      endDay.setDate(endDay.getDate() + days)
      if (new Date() > endDay) {
        this.status = "已结束"
      }
    }
  }
}

// 把当前活动设置为可供后续创建新活动的样子
// 即把活动id、活动日期、队员列表、网站同步信息、活动状态、活动留言、活动二维码、付款信息等和特定活动相关的信息置空
OD.prototype.setDefault4New = function(leader) {
  console.log("OD.prototype.setDefault4New()")
  this.outdoorid = null
  this.title.date = null
  this.leader = leader
  this.members = []
  this.addMembers = []
  this.aaMembers = []
  this.websites = odtools.getDefaultWebsites()
  this.chat = {
    messages: []
  }
  this.QcCode = null
  this.pay = null
  this.operations = null
  this.status = "拟定中"
}

// 内容审查，若不通过，返回false
OD.prototype.check = async function () {
  var content = this.brief.disc
  content += this.title.place
  for(var i in this.meets) {
    content += this.meets[i].place
  }
  // content += this.limits.disclaimer
  var result = await cloudfun.checkMsg(content)
  if (!result) {
    wx.showToast({ title: '内容审查失败'})
  }
  return result
}


// 保存（更新）od到数据库中，若之前没有保存过，则新建一条记录
// myself：自己的报名信息
// modifys: 修改了哪些项目 
OD.prototype.save = async function(myself, modifys) {
  console.log("OD.prototype.save()",myself, modifys)
  console.log("outdoorid: " + this.outdoorid)
   // 先进行内容审查
  if (!await this.check()) {
    return null
  }
  if (this.outdoorid) {
    // 进行中或已结束的活动，不能保存
    if (this.status != '进行中' && this.status != '已结束') {
      // 必须先刷新一下成员，不然容易覆盖
      let res = await dbOutdoors.doc(this.outdoorid).get()
      this.members = res.data.members
      // 找到自己的index，并更新信息
      this.members.forEach((item, index) => {
        if (item.personid == myself.personid) {
          this.members[index] = myself // 不能用item设置，大坑
          console.log("members[index]: ", index, myself)
        }
      })

      console.log("outdoorid: ", this.outdoorid)
      console.log("members: ", this.members)
      await cloudfun.updateOutdoor(this.outdoorid, this)

      // 如果设置了与网站同步，则需要即时处理
      this.postWaitings()
      // 修改的内容同步到网站上
      this.postModify2Websites(modifys)
      // 信息修改要发送给队员
      this.sendModify2Members(modifys)
      wx.showToast({title: '保存成功',})
    }
  } else { // 若之前没有保存过，则创建活动记录
    await this.create(myself)
  }
  return this
}

// 发布活动，失败返回false
OD.prototype.publish = async function(leader) {
  console.log("OD.prototype.publish()")
  const self = this
  // 保存到数据库中
  this.leader = leader
  if(await this.save(leader, {})){
    if (!this.limits.private) { // 私约活动默认不发布到org网站
      // 确定绿野org版面，发布出去
      var fid = lvyeorg.chooseForum(this.title, this.limits.isTest)
      this.push2org(fid)
    }
    wx.showToast({ title: '发布成功' })
    return true
  }
  // wx.showToast({ title: '发布失败' })
  return false
}

// 删除活动，删除后不得再调用任何内容 
// 返回被清空后的活动内容 
OD.prototype.del = async function() {
  console.log("OD.prototype.del()")
  console.log("outdoorid:" + this.outdoorid)
  await dbOutdoors.doc(this.outdoorid).remove()
  this.clear() // 清空内容
  this.outdoorid = null // id设置为null
  wx.showToast({ title: '已删除' })
  return this
}

// 清空活动内容
OD.prototype.clear = function() {
  console.log("OD.prototype.clear()")
  console.log("outdoorid:" + this.outdoorid)
  this.deleteClouds() // 删除云存储上的内容
  var temp = this.outdoorid // id 要保留下来
  var empty = new OD()
  for (var key in empty) { // 彻底清空内存
    this[key] = empty[key]
  }
  this.outdoorid = temp
  wx.showToast({ title: '已清空' })
}

// 删除云存储上的内容，主要是照片和轨迹文件
OD.prototype.deleteClouds = async function() {
  console.log("OD.prototype.deleteClouds()")
  var dels = []
  for (var i in this.brief.pics) {
    dels.push(this.brief.pics[i].src)
  }
  for (var i in this.brief.trackFiles) {
    dels.push(this.brief.trackFiles[i].src)
  }
  for (var i in this.photos) {
    dels.push(this.photos[i].src)
  }

  await wx.cloud.deleteFile({
    fileList: dels
  })
}

// 以当前活动od为模板，创建新活动；leader是领队信息 
// 返回活动id   
OD.prototype.create = async function(leader) {
  console.log("OD.prototype.create()")
  leader.entryInfo.status = "领队"
  this.leader = leader
  let res = await dbPersons.doc(leader.personid).get()

  // 领队有免责条款时，则用领队自己的
  if (res.data.disclaimer) {
    this.limits.disclaimer = res.data.disclaimer
  }

  var members = [leader] // 把领队作为第一个队员
  // 没有outdoor id,则新加一条记录
  let resOD = await dbOutdoors.add({
    data: {
      brief: this.brief,
      leader: leader, // 写入领队信息 
      limits: this.limits,
      meets: this.meets,
      members: members,
      route: this.route,
      status: this.status,
      title: this.title,
      traffic: this.traffic,
      websites: this.websites,
      chat: this.chat,
    }
  })

  this.outdoorid = resOD._id
  // 把照片和轨迹文件也复制一份给本活动
  this.copyPics()
  this.copyTrackFiles()
}

// 复制照片
OD.prototype.copyPics = async function() {
  console.log("OD.prototype.copyPics()")
  console.log(this.brief.pics)
  this.brief.pics.forEach(async(item, index) => {
    // 没找到当前id，说明图片是之前活动的，则需要下载，再上传图片
    if (!item.src.match(this.outdoorid)) {
      let resDown = await wx.cloud.downloadFile({ // 下载先
        fileID: item.src
      })
      let resUp = await wx.cloud.uploadFile({ // 再上传到自己的活动目录下
        cloudPath: util.buildPicSrc(this.outdoorid, index),
        filePath: resDown.tempFilePath, // 小程序临时文件路径
      })
      item.src = resUp.fileID;
      console.log("copyPics")
      console.log(this.brief.pics)
      cloudfun.opOutdoorItem(this.outdoorid, "brief.pics", this.brief.pics, "")
    }
  })
}

// 复制轨迹文件
OD.prototype.copyTrackFiles = async function() {
  console.log("OD.prototype.copyTrackFiles()")
  console.log(this.route.trackFiles)
  if (this.route.trackFiles) {
    this.route.trackFiles.forEach(async (item, index) => {
      // 没找到当前id，说明文件是之前活动的，则需要下载，再上传
      if (!item.src.match(this.outdoorid)) {
        console.log("download src: " + item.src)
        let resDown = await wx.cloud.downloadFile({ // 下载先
          fileID: item.src
        })
        let resUp = await wx.cloud.uploadFile({ // 再上传到自己的活动目录下
          cloudPath: util.buildRouteSrc(this.outdoorid, item.name),
          filePath: resDown.tempFilePath, // 小程序临时文件路径
        })
        item.src = resUp.fileID;
        console.log("copyTrackFiles")
        console.log(this.route.trackFiles)
        cloudfun.opOutdoorItem(this.outdoorid, "route.trackFiles", this.route.trackFiles, "")
      }
    })
  }
}

// 保存某个子项
// name：子项的名字，内部自动匹配 
OD.prototype.saveItem = async function(name) {
  console.log("OD.prototype.saveItem()" + name)
  console.log("outdoorid: " + this.outdoorid)
  // 进行中或已结束的活动，不允许保存
  if (this.status != '进行中' && this.status != '已结束') {
  // if (true) {
    var value = util.getValue(this, name)
    console.log(value)
    // 存储到数据库中
    let res = await cloudfun.opOutdoorItem(this.outdoorid, name, value, "")
    console.log(res)

    var modifys = {} // 提取修改的第一级子项的名字
    modifys[name.split(".")[0]] = true
    console.log(modifys)
    // 一些重要的基本信息被修改，需要通知到所有已报名队员
    this.sendModify2Members(modifys)
    // 同步到网站
    this.postModify2Websites(modifys)

    wx.showToast({title: '保存成功'})
  } else {
    wx.showToast({ title: '不能保存'})
  }
}

// 一些重要的基本信息被修改，需要通知到所有已报名队员
OD.prototype.sendModify2Members = async function(modifys) {
  console.log("OD.prototype.sendModify2Members()")
  console.log(modifys)
  // 只有活动标题和集合地点内容修改，才发通知给队员
  if (modifys.title || modifys.meets) {
    if (this.status == "已发布" || this.status == "已成行") {
      for (let item of this.members) {
        await template.sendModifyMsg2Member(item.personid, this.outdoorid, this.title.whole, this.leader.userInfo.nickName, modifys)
      }
    }
  }
}

// 报名。若已经存在，则更新状态；若不存在，则添加到最后
// 返回报名状态 status，以及是否属于新增加报名 
OD.prototype.entry = async function(member) {
  console.log("OD.prototype.entry()", member)
  // 第一步，刷新members，防止之前已经有人报名了
  let res = await dbOutdoors.doc(this.outdoorid).get()
  this.members = res.data.members
  this.addMembers = res.data.addMembers ? res.data.addMembers : [] // 防止为null

  // 第二步，判断是更新报名信息，还是新报名
  var findSelf = false
  this.members.forEach((item, index) => {
    if (item.personid == member.personid) {
      this.members[index] = member // 找到自己的index，就更新信息
      findSelf = true
    }
  })

  // 第三步，新报名，则需要判断是否属于替补
  if (!findSelf) {
    if (this.limits.maxPerson && (this.members.length + this.addMembers.length >= this.limits.personCount)) {
      member.entryInfo.status = "替补中"
    }
    this.members.push(member)
    // 新报名，才有必要看看是否处理AA名单；修改报名状态时用不着的
    this.dealAaMembers(member) // 处理AA名单
  }

  // 更新Outdoors数据库
  cloudfun.opOutdoorItem(this.outdoorid, "members", this.members, "")
  // 记录报名操作历史
  // this.recordOperation(member.entryInfo.status, member.userInfo.nickName)
  // 报名信息同步到网站
  this.postEntry2Websites(member, false, false)
  return {
    status: member.entryInfo.status,
    entry: !findSelf
  }
}

// 记录报名退出等重要操作
OD.prototype.recordOperation = function (action, nickName) {
  cloudfun.opOutdoorItem(this.outdoorid, "operations", {action, nickName}, "push")
}

// 有人新报名时，需要处理AA名单
OD.prototype.dealAaMembers = function(member) {
  console.log("OD.prototype.dealAaMembers()")
  if (this.aaMembers && this.aaMembers.length > 0) {
    var index = util.findIndex(this.aaMembers, "personid", member.personid)
    // 首先从AA名单中剔除自己（即退出后又报名的情况）
    if (index > -1) { //找到自己，则删掉即可
      this.aaMembers.splice(index, 1)
      cloudfun.opOutdoorItem(this.outdoorid, "aaMembers", this.aaMembers, "")
    } else if (this.limits.maxPerson) {
      // 若非上述情况，且正式名单 + AA名单超过名额限制，则剔除AA名单中的第一位，保证分摊费用的人数不应超过原定总人数
      if ((this.members.length + this.aaMembers.length) > this.limits.personCount) {
        this.aaMembers.splice(0, 1)
        cloudfun.opOutdoorItem(this.outdoorid, "aaMembers", this.aaMembers, "")
      }
    }
  }
}

// 为附加队员报名 
// 成功返回success和附加队员名单；失败返回failed  
OD.prototype.entry4Add = async function(addMember) {
  console.log("OD.prototype.entry4Add()")
  // 第一步，刷新members，防止之前已经有人报名了
  let res = await dbOutdoors.doc(this.outdoorid).get()
  this.members = res.data.members
  this.addMembers = res.data.addMembers ? res.data.addMembers : [] // 防止为null

  // 第二步，看看是否人员已满，附加队员无法替补
  if (this.limits.maxPerson && (this.members.length + this.addMembers.length >= this.limits.personCount)) {
    // 人满了就只能直接返回
    return {
      failed: true
    }
  } else {
    this.addMembers.push(addMember)

    // 更新Outdoors数据库
    cloudfun.opOutdoorItem(this.outdoorid, "addMembers", this.addMembers, "")
    // 为附加队员，构造一个假的member
    var member = {
      entryInfo: {
        status: "报名中",
        meetsIndex: "不定"
      },
      userInfo: {
        nickName: addMember,
        phone: "",
        gender: "不明"
      }
    }
    // 报名信息同步到网站
    this.postEntry2Websites(member, false, false)
    return {
      success: true,
      addMembers: this.addMembers
    }
  }
}

// 附加队员退出
// index：指定index的附加队员退出
OD.prototype.quit4Add = function(index) {
  console.log("OD.prototype.quit4Add()")
  // 判断index范围
  if (index >= 0 && index < this.addMembers.length) {

    // 看是否会导致替补队员转正
    var bench = this.firstBench2Member()
    // 写入数据库 
    if (bench) {
      cloudfun.opOutdoorItem(this.outdoorid, "members", this.members, "")
    }

    var delName = this.addMembers.splice(index, 1)[0]
    cloudfun.opOutdoorItem(this.outdoorid, "addMembers", this.addMembers, "")

    // 同步到网站
    // 构造一个假的member
    var member = {
      entryInfo: {},
      userInfo: {
        nickName: delName
      }
    }
    // 报名信息同步到网站
    this.postEntry2Websites(member, true, false)
  }
}

// 排位第一的替补转正
// 信息同步到网站，并发送微信消息；但不负责保存到数据库
// 有替补，则返回true
OD.prototype.firstBench2Member = function() {
  console.log("OD.prototype.firstBench2Member()")
  if (this.limits.maxPerson) {
    for (var i in this.members) {
      if (this.members[i].entryInfo.status == "替补中") {
        this.members[i].entryInfo.status = "报名中"
        // 给退出者发消息
        template.sendEntryMsg2Bench(this.members[i].personid, this.outdoorid, this.title.whole, this.members[i].userInfo.nickName)
        this.postEntry2Websites(this.members[i], false, false)
        return true // 仅限一位
      }
    }
  }
  return false
}

// 退出报名（正式队员）
// personid: 退出者id
// selfQuit：是否为自行退出（false则为领队强制退出）
// 返回 剩余的队员数组  
OD.prototype.quit = async function(personid, selfQuit) {
  console.log("OD.prototype.quit()")
  // 第一步：刷新重要信息
  let res = await dbOutdoors.doc(this.outdoorid).get()
  this.members = res.data.members
  this.addMembers = res.data.addMembers ? res.data.addMembers : []
  this.limits = res.data.limits

  // 第二步：找到自己
  var index = util.findIndex(this.members, "personid", personid)
  if (index >= 0) {
    var member = this.members[index]

    // 第三步：判断是否能让替补上；原则：我不是替补，我退出，就让第一个替补顶上
    var isAfee = odtools.isNeedAA(this, member.entryInfo.status) // 判断是否A费用
    isAfee = selfQuit ? isAfee : false // 若不是自行退出（领队驳回），则肯定不用A费用
    if (member.entryInfo.status != "替补中") {
      var hasBench = this.firstBench2Member()
      if (isAfee && hasBench) { // 如果有替补，又要A费用，就说明有地方出错了
        console.error("isAfee: ", isAfee, "hasBench: ", hasBench)
      }
    }

    var deleted = this.members.splice(index, 1) // 别忘了删除自己
    // 第四步：新成员列表写入数据库
    cloudfun.opOutdoorItem(this.outdoorid, "members", this.members, "")
    // 退出记录一下
    this.recordOperation("退出", member.userInfo.nickName)
    if (isAfee) { // 要A费用的时候，单独开一个名单列表
      this.aaMembers.push(deleted)
      cloudfun.opOutdoorItem(this.outdoorid, "aaMembers", deleted, "push")
    }

    // 第五步：给退出者发消息
    if (selfQuit) {
      var remark = "您已自行退出本次活动。您仍可以点击进入小程序继续报名。"
      if (isAfee) {
        remark += "由于活动已成行，您退出且无人替补，请联系领队A费用。"
      }
      template.sendQuitMsg2Self(member.personid, this.outdoorid, this.title.whole, this.title.date, this.leader.userInfo.nickName, member.userInfo.nickName, remark)
    } else {
      var remark = "您已被领队驳回报名，可点击回到活动的“留言”页面中查看原因。若仍有意参加，可在留言中@领队或电话等方式联系领队确认情况。"
      // 发模板消息
      template.sendRejectMsg2Member(member.personid, this.title.whole, this.outdoorid, this.leader.userInfo.nickName, this.leader.userInfo.phone, remark)
    }

    // 第六步：同步到网站
    this.postEntry2Websites(member, true, selfQuit)
    // 第七步：返回结果
    return {
      members: this.members,
      isAfee: isAfee
    }
  }
}

// 转让领队
OD.prototype.transferLeader = async function(oldLeader, newLeader) {
  console.log("OD.prototype.transferLeader()")
  console.log(oldLeader, newLeader)
  if (this.leader) { // 核实领队身份
    console.assert(this.leader.personid == oldLeader)
  } else {
    console.assert(this.members[0].personid == oldLeader)
  }

  const res = await dbOutdoors.doc(this.outdoorid).get()
  this.members = res.data.members
  var index = util.findIndex(this.members, "personid", newLeader)
  if (index >= 1) {
    console.log("find new leader index: " + index)
    this.leader = this.members[index] // 设置领队
    this.members[index] = this.members[0] // 原领队挪到后面
    this.members[index].entryInfo.status = "领队组"
    this.members[0] = this.leader // 新领队放到第一
    this.members[0].entryInfo.status = "领队"
    // cloudfun.updateOutdoorMembers(this.outdoorid, this.members)
    cloudfun.opOutdoorItem(this.outdoorid, "members", this.members, "")
    // cloudfun.updateOutdoorLeader(this.outdoorid, this.members[0])
    cloudfun.opOutdoorItem(this.outdoorid, "leader", this.members[0], "")

    this.title.whole = odtools.createTitle(this.title, this.leader.userInfo.nickName)
    cloudfun.opOutdoorItem(this.outdoorid, "title", this.title, "")
    // 两个人的 outdoors内容也要处理
    var value = {
      id: this.outdoorid,
      title: this.title.whole
    }
    // 原领队（现队员），myOutdoors中去掉本项，entriedOutdoors中增加
    person.dealOutdoors(this.members[index].personid, "myOutdoors", value, true)
    person.dealOutdoors(this.members[index].personid, "entriedOutdoors", value, false)
    // 现领队（原队员），myOutdoors中增加本项，entriedOutdoors中去掉
    person.dealOutdoors(this.members[0].personid, "myOutdoors", value, false)
    person.dealOutdoors(this.members[0].personid, "entriedOutdoors", value, true)
    // 给所有队员发通知
    // this.members.forEach((item, i) => {
    for (let item of this.members) {
      // old(index) ==> new （0）
      await template.sendResetMsg2Member(this.outdoorid, item.personid, this.title.whole, this.members[index].userInfo.nickName, this.members[0].userInfo.nickName, this.leader.personid)
    }

    return this.members
  }
}

//////////////////  户外网站处理 start  /////////////////////////////////////////////

// 若已登录，返回tid（帖子id）；否则返回null
OD.prototype.getTid = function() {
  console.log("OD.prototype.getTid()")
  const lvyeobj = this.websites.lvyeorg // 当前只对接了lvye org网址
  console.log(lvyeobj)
  // 第一步，得有要求同步才行，并且还得登录网址了
  if (app.globalData.lvyeorgLogin) {
    // 第二步，判断是否已经发帖; 已发布和已成行的活动，尚未发帖，则应立即发帖
    return lvyeobj.tid
  }
  return null
}

// 把活动同步到org网站上，只提供领队明确发布
OD.prototype.push2org = async function(fid) {
  console.log("OD.prototype.push2org()",fid)
  const lvyeobj = this.websites.lvyeorg // 当前只对接了lvye org网址
  console.log(lvyeobj)
  // 第一步，得登录网址
  if (app.globalData.lvyeorgLogin) {
    // 第二步，判断是否已经发帖; 已发布和已成行的活动，尚未发帖，则应立即发帖
    if (!lvyeobj.tid) {
      let tid = await lvyeorg.addThread(this.outdoorid, this, fid)
      console.log("tid: " + tid)
      if (tid) {
        lvyeobj.tid = tid
        return tid
      }
    } else if (lvyeobj.tid) {
      console.error("已经同步到org上，不要重复同步")
      return lvyeobj.tid
    }
  }
}

// 判断处理websites中的信息，主要就是把信息同步到网站 
OD.prototype.postWaitings = async function() {
  console.log("OD.prototype.postWaitings()")
  const lvyeobj = this.websites.lvyeorg // 当前只对接了lvye org网址
  console.log(lvyeobj)
  // 得有要求同步才行，并且还得登录网址了
  if (app.globalData.lvyeorgLogin) {
    // 必须已经发帖，再看看是否有waitings需要推送
    // 若之前没有发帖成功，则现在发帖
    var tid = this.getTid()
    if (tid) {
      console.log("tid: " + tid)
      // 为了防止多人同时load，waitings信息被多次发送，增加数据库锁机制
      // 思路：1）再次刷新得到waitings和posting信息
      //       2）若posting为false，则把数据库中的posting改为true，然后发送waitings信息；若posting为true，则啥也不干
      //       3）发送结束，把数据库中的posting改为false，清空waitings
      if (tid && lvyeobj.waitings && lvyeobj.waitings.length > 0) {
        var websites = await odtools.getWebsites(this.outdoorid) // 1）
        if (!websites.lvyeorg.posting) { // 别人没有posting中，自己才能干活
          await cloudfun.opOutdoorItem(this.outdoorid, "websites.lvyeorg.posting", true, "") // 2.1）
          await lvyeorg.postWaitings(lvyeobj.tid, websites.lvyeorg.waitings) // 2.1）  
          await cloudfun.opOutdoorItem(this.outdoorid, "websites.lvyeorg.posting", false, "") // 3.1）
          await cloudfun.opOutdoorItem(this.outdoorid, "websites.lvyeorg.waitings", [], "") // 3.2）
          lvyeobj.waitings = [] // 自己内存中的也要清空
          lvyeobj.posting = false
        }
      }
    }
  }
}

// 把修改信息同步到网站
OD.prototype.postModify2Websites = function(modifys) {
  console.log("OD.prototype.postModify2Websites()")
  console.log(modifys)
  // 有修改项，且不是拟定中，才写入
  if (util.anyTrue(modifys) && this.status != "拟定中") {
    console.log("anyTrue: " + util.anyTrue(modifys))
    const lvyeobj = this.websites.lvyeorg
    if (lvyeobj.tid) {
      var addedMessage = "领队对以下内容作了更新，请报名者留意！"
      var message = lvyeorg.buildOutdoorMesage(this, false, modifys, addedMessage, this.websites.lvyeorg.allowSiteEntry) // 构建活动信息

      this.postMessage2Websites(addedMessage, addedMessage + message)
    }
  }
}

// 同步信息到网站
OD.prototype.postMessage2Websites = function(title, message) {
  console.log("OD.prototype.postMessage2Websites()")
  const lvyeobj = this.websites.lvyeorg
  // 登录了，且有tid了，就直接跟帖报名
  if (lvyeobj.tid && app.globalData.lvyeorgLogin) {
    lvyeorg.postMessage(this.outdoorid, this.websites.lvyeorg.tid, title, message)
  } else { // 没有登录，或者tid还没有，则记录到waitings中
    lvyeorg.add2Waitings(this.outdoorid, message)
  }
}

// 报名信息同步到网站
// member：要报名的队员信息，
// isQuit：是否为退出；
// selfQuit ：是否为自行退出；false时为领队强制清退
OD.prototype.postEntry2Websites = function(member, isQuit, selfQuit) {
  const lvyeobj = this.websites.lvyeorg
  // 先确定是否要同步
  if (lvyeobj.tid) {
    // 构建报名信息
    var entryMessage = lvyeorg.buildEntryMessage(member.userInfo, member.entryInfo, isQuit, selfQuit, false)
    var entryNotice = lvyeorg.buildEntryNotice(lvyeobj.qrcodeUrl, false, lvyeobj.allowSiteEntry)
    entryMessage.message += entryNotice

    this.postMessage2Websites(entryMessage.title, entryMessage.message)
  }
}

//////////////////  户外网站处理 end  /////////////////////////////////////////////


module.exports = {
  OD: OD,
  load: OD.prototype.load,
  save: OD.prototype.save,
  publish: OD.prototype.publish,
  del: OD.prototype.del,
  clear: OD.prototype.clear,
  saveItem: OD.prototype.saveItem,
  setDefault4New: OD.prototype.setDefault4New,
  entry: OD.prototype.entry,
  quit: OD.prototype.quit,
  entry4Add: OD.prototype.entry4Add, // 为附加队员报名
  quit4Add: OD.prototype.quit4Add, // 附加队员退出
  transferLeader: OD.prototype.transferLeader, // 转让领队

  // org同步功能
  push2org: OD.prototype.push2org, // 同步到org网址
  postWaitings: OD.prototype.postWaitings,

  // 以下为内部函数，外面不得调用
  // create: OD.prototype.create, // save内部判断处理
  // 
  // removeOcuppy:OD.prototype.removeOcuppy,
  // copyPics:OD.prototype.copyPics,
  // copyTrackFiles:OD.prototype.copyTrackFiles,
}