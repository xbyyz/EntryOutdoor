Page({

  data: {
    MeetDates: ["前三天", "前两天", "前一天", "当天"],
    meetDatesIndex: 3, // 默认是当天集合
    
    meet: {
      place: "",
      date: "当天",
      time: "",
    },
    index: -1,
    hasModified:false,

    action: null, // 发起这个页面的行为
  },

  onLoad: function(options) {
    console.log(options)
    const self = this
    if (options.index) {
      self.setData({
        index: options.index
      })
    }

    if (options.action) {
      self.data.action = options.action
      if (self.data.action == "edit") {
        // 编辑，则先把原来的加载进来
        let pages = getCurrentPages(); //获取当前页面js里面的pages里的所有信息。
        let prevPage = pages[pages.length - 2];
        self.setData({
          meet: prevPage.data.meets[options.index]
        })
      }
    }
  },

  // 记录输入集合点
  inputMeetPlace: function(e) {
    console.log(e)
    this.setData({
      "meet.place": e.detail,
      hasModified:true,
    })
  },

  // 记录输入集合点的日期
  changMeetDate: function(e) {
    console.log(e)
    const self = this;
    self.setData({
      "meet.date": self.data.MeetDates[e.detail.value],
      hasModified: true,
    })
  },

  // 记录输入路线点的达到预计时间
  changMeetTime: function(e) {
    console.log(e)
    this.setData({
      "meet.time": e.detail.value,
      hasModified: true,
    })
  },

  clickSaveAndBack: function() {
    const self = this
    let pages = getCurrentPages(); //获取当前页面js里面的pages里的所有信息。
    let prevPage = pages[pages.length - 2];
    console.log(self.data.action)
    console.log(self.data.meet)
    if (self.data.action == "edit") {
      prevPage.setData({
        ['meets[' + self.data.index + ']']: self.data.meet,
        hasModified: self.data.hasModified,
      })
    } else {
      if (self.data.action == "addLast") {
        // 往最后追加一个集合点
        prevPage.data.meets.push(self.data.meet)
      } else if (self.data.action == "addBefore") {
        prevPage.data.meets.splice(self.data.index, 0, self.data.meet)
      } else if (self.data.action == "addAfter") {
        prevPage.data.meets.splice(self.data.index+1, 0, self.data.meet)
      }
      prevPage.setData({
        meets: prevPage.data.meets,
        hasModified: true,
      })
      prevPage.rebuildClickMeetFun()
    }
    
    wx.navigateBack({})
  },

})