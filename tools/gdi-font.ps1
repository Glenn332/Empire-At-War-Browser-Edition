$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class GameFontRaster {
  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l,t,r,b; }
  [StructLayout(LayoutKind.Sequential)] public struct TM {
    public int height,ascent,descent,internalLeading,externalLeading,average,maximum,weight,overhang,aspectX,aspectY;
    public ushort first,last,def,brk; public byte italic,under,strike,pitch,charset;
  }
  [StructLayout(LayoutKind.Sequential)] public struct BI {
    public uint size; public int width,height; public ushort planes,bits;
    public uint compression,imageSize; public int xppm,yppm; public uint used,important;
  }
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
  [DllImport("gdi32.dll",CharSet=CharSet.Ansi)] static extern IntPtr CreateFontA(int h,int w,int e,int o,int weight,uint italic,uint under,uint strike,uint charset,uint output,uint clip,uint quality,uint pitch,string name);
  [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern bool GetTextMetricsW(IntPtr dc,out TM metrics);
  [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern bool GetTextExtentPoint32W(IntPtr dc,string text,int count,out SIZE size);
  [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern bool ExtTextOutW(IntPtr dc,int x,int y,uint options,ref RECT rect,string text,uint count,IntPtr dx);
  [DllImport("gdi32.dll")] static extern uint SetTextColor(IntPtr dc,uint color);
  [DllImport("gdi32.dll")] static extern uint SetBkColor(IntPtr dc,uint color);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc,ref BI info,uint usage,out IntPtr bits,IntPtr section,uint offset);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();
  [DllImport("gdi32.dll")] static extern IntPtr AddFontMemResourceEx(byte[] data,uint size,IntPtr reserved,out uint count);
  [DllImport("gdi32.dll",CharSet=CharSet.Ansi)] static extern int GetTextFaceA(IntPtr dc,int count,System.Text.StringBuilder name);
  public static void Add(byte[] data) { uint count; if(AddFontMemResourceEx(data,(uint)data.Length,IntPtr.Zero,out count)==IntPtr.Zero) throw new Exception("Cannot register font"); }
  public sealed class Atlas { public int height,ascent,average,page,weight,charset; public string face,mask; public int[] widths,offsets; }
  static IntPtr Font(int height,int width,string face,bool bold,int charset) {
    var font=CreateFontA(height,width,0,0,bold?700:400,0,0,0,(uint)charset,0,0,4,2,face);
    if(font==IntPtr.Zero)throw new Exception("CreateFont failed: "+face);
    return font;
  }
  public static Atlas Render(string face,int height,float stretch,int page,bool bold,int charset) {
    IntPtr dc=CreateCompatibleDC(IntPtr.Zero),font=IntPtr.Zero,bitmap=IntPtr.Zero,oldFont=IntPtr.Zero,oldBitmap=IntPtr.Zero;
    try {
      font=Font(-height,0,face,bold,charset); oldFont=SelectObject(dc,font);
      var selected=new System.Text.StringBuilder(256); GetTextFaceA(dc,256,selected);
      if(!String.Equals(selected.ToString(),face,StringComparison.OrdinalIgnoreCase) && face!="Arial") {
        SelectObject(dc,oldFont);DeleteObject(font);face="Arial";font=Font(-height,0,face,bold,charset);SelectObject(dc,font);
      }
      TM metrics;GetTextMetricsW(dc,out metrics);
      if(stretch>=1.0001f || stretch<=.9999f) {
        SelectObject(dc,oldFont);DeleteObject(font);font=Font((int)Math.Floor(-height*stretch+.5f),metrics.average,face,bold,charset);SelectObject(dc,font);GetTextMetricsW(dc,out metrics);
      }
      selected.Clear();GetTextFaceA(dc,256,selected);
      var atlas=new Atlas { height=metrics.height,ascent=metrics.ascent,average=metrics.average,page=page,weight=metrics.weight,charset=charset,face=selected.ToString(),widths=new int[256],offsets=new int[256] };
      int widest=1,total=0;
      for(int i=0;i<256;i++) { SIZE size;GetTextExtentPoint32W(dc,new string((char)(page*256+i),1),1,out size);atlas.widths[i]=size.x;atlas.offsets[i]=total;total+=size.x*metrics.height;widest=Math.Max(widest,size.x); }
      widest=Math.Max(widest,(metrics.maximum+3)&~3);
      int stride=(widest*3+3)&~3,bytes=stride*metrics.height;
      BI info=new BI { size=40,width=widest,height=-metrics.height,planes=1,bits=24,imageSize=(uint)bytes };
      IntPtr bits;bitmap=CreateDIBSection(dc,ref info,0,out bits,IntPtr.Zero,0);oldBitmap=SelectObject(dc,bitmap);
      SetTextColor(dc,0xffffff);SetBkColor(dc,0);
      byte[] dib=new byte[bytes],mask=new byte[total],zero=new byte[bytes];
      for(int i=0;i<256;i++) {
        Marshal.Copy(zero,0,bits,bytes);int w=atlas.widths[i];if(w==0)continue;
        RECT rect=new RECT { l=0,t=0,r=w-1,b=metrics.height-1 };
        ExtTextOutW(dc,0,0,2,ref rect,new string((char)(page*256+i),1),1,IntPtr.Zero);GdiFlush();Marshal.Copy(bits,dib,0,bytes);
        for(int y=0;y<metrics.height;y++)for(int x=0;x<w;x++)mask[atlas.offsets[i]+y*w+x]=dib[y*stride+x*3];
      }
      atlas.mask=Convert.ToBase64String(mask);return atlas;
    } finally {
      if(oldBitmap!=IntPtr.Zero)SelectObject(dc,oldBitmap);if(bitmap!=IntPtr.Zero)DeleteObject(bitmap);
      if(oldFont!=IntPtr.Zero)SelectObject(dc,oldFont);if(font!=IntPtr.Zero)DeleteObject(font);DeleteDC(dc);
    }
  }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.fonts) { foreach ($font in $request.fonts) { [GameFontRaster]::Add([Convert]::FromBase64String($font)) }; [Console]::WriteLine('{"ready":true}') }
    else { $atlas = [GameFontRaster]::Render($request.face,[int]$request.height,[single]$request.stretch,[int]$request.page,[bool]$request.bold,[int]$request.charset); [Console]::WriteLine(($atlas | ConvertTo-Json -Compress -Depth 5)) }
  } catch { [Console]::WriteLine((@{error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}
