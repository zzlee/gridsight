/* stb_image_write - v1.16 - public domain - http://nothings.org/stb
   JPEG writer component for GridSight native agent
*/
#ifndef INCLUDE_STB_IMAGE_WRITE_H
#define INCLUDE_STB_IMAGE_WRITE_H

#include <stdlib.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void stbi_write_func(void *context, void *data, int size);

int stbi_write_jpg_to_func(stbi_write_func *func, void *context, int x, int y, int comp, const void *data, int quality);

#ifdef STB_IMAGE_WRITE_IMPLEMENTATION

static void stbiw__write_context(stbi_write_func *func, void *context, const void *data, int size) {
   func(context, (void*)data, size);
}

// JPEG compression tables and routine
static const unsigned char stbiw__jpg_ZigZag[] = {
   0, 1, 5, 6, 14, 15, 27, 28,
   2, 4, 7, 13, 16, 26, 29, 42,
   3, 8, 12, 17, 25, 30, 41, 43,
   9, 11, 18, 24, 31, 40, 44, 53,
   10, 19, 23, 32, 39, 45, 52, 54,
   20, 22, 33, 38, 46, 51, 55, 60,
   21, 34, 37, 47, 50, 56, 59, 61,
   35, 36, 48, 49, 57, 58, 62, 63
};

static const unsigned char stbiw__jpg_LuminanceQuantTable[64] = {
   16, 11, 10, 16, 24, 40, 51, 61,
   12, 12, 14, 19, 26, 58, 60, 55,
   14, 13, 16, 24, 40, 57, 69, 56,
   14, 17, 22, 29, 51, 87, 80, 62,
   18, 22, 37, 56, 68, 109, 103, 77,
   24, 35, 55, 64, 81, 104, 113, 92,
   49, 64, 78, 87, 103, 121, 120, 101,
   72, 92, 95, 98, 112, 100, 103, 99
};

static const unsigned char stbiw__jpg_ChrominanceQuantTable[64] = {
   17, 18, 24, 47, 99, 99, 99, 99,
   18, 21, 26, 66, 99, 99, 99, 99,
   24, 26, 56, 99, 99, 99, 99, 99,
   47, 66, 99, 99, 99, 99, 99, 99,
   99, 99, 99, 99, 99, 99, 99, 99,
   99, 99, 99, 99, 99, 99, 99, 99,
   99, 99, 99, 99, 99, 99, 99, 99,
   99, 99, 99, 99, 99, 99, 99, 99
};

typedef struct {
   stbi_write_func *func;
   void *context;
   unsigned short bitBuf;
   int bitCnt;
} stbiw__jpg_bitstream;

static void stbiw__jpg_writeBits(stbiw__jpg_bitstream *bs, unsigned short val, int bits) {
   bs->bitBuf |= (val << (16 - bs->bitCnt - bits));
   bs->bitCnt += bits;
   while (bs->bitCnt >= 8) {
      unsigned char c = (unsigned char)((bs->bitBuf >> 8) & 0xFF);
      stbiw__write_context(bs->func, bs->context, &c, 1);
      if (c == 0xFF) {
         unsigned char zero = 0;
         stbiw__write_context(bs->func, bs->context, &zero, 1);
      }
      bs->bitBuf <<= 8;
      bs->bitCnt -= 8;
   }
}

static void stbiw__jpg_flushBits(stbiw__jpg_bitstream *bs) {
   if (bs->bitCnt > 0) {
      unsigned char c = (unsigned char)((bs->bitBuf >> 8) & 0xFF);
      stbiw__write_context(bs->func, bs->context, &c, 1);
      if (c == 0xFF) {
         unsigned char zero = 0;
         stbiw__write_context(bs->func, bs->context, &zero, 1);
      }
      bs->bitBuf = 0;
      bs->bitCnt = 0;
   }
}

static const unsigned char stbiw__jpg_std_dc_luminance_nrcodes[] = {0,0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0};
static const unsigned char stbiw__jpg_std_dc_luminance_values[] = {0,1,2,3,4,5,6,7,8,9,10,11};
static const unsigned char stbiw__jpg_std_dc_chrominance_nrcodes[] = {0,0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0};
static const unsigned char stbiw__jpg_std_dc_chrominance_values[] = {0,1,2,3,4,5,6,7,8,9,10,11};
static const unsigned char stbiw__jpg_std_ac_luminance_nrcodes[] = {0,0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d};
static const unsigned char stbiw__jpg_std_ac_luminance_values[] = {
   0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
   0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,
   0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,
   0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,
   0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,
   0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
   0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,
   0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,
   0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,
   0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
   0xf9,0xfa
};
static const unsigned char stbiw__jpg_std_ac_chrominance_nrcodes[] = {0,0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77};
static const unsigned char stbiw__jpg_std_ac_chrominance_values[] = {
   0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,
   0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,
   0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,
   0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,
   0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,
   0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,
   0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,
   0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,
   0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,
   0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
   0xf9,0xfa
};

typedef struct {
   unsigned short code[256];
   unsigned char size[256];
} stbiw__jpg_huffman_table;

static void stbiw__jpg_build_huffman(const unsigned char *nrcodes, const unsigned char *values, stbiw__jpg_huffman_table *ht) {
   int k = 0;
   unsigned short code = 0;
   for (int i = 1; i <= 16; ++i) {
      for (int j = 0; j < nrcodes[i]; ++j) {
         ht->code[values[k]] = code;
         ht->size[values[k]] = (unsigned char)i;
         code++;
         k++;
      }
      code <<= 1;
   }
}

static void stbiw__jpg_write_marker(stbi_write_func *func, void *context, unsigned char marker) {
   unsigned char m[2] = { 0xFF, marker };
   stbiw__write_context(func, context, m, 2);
}

static void stbiw__jpg_write_dqt(stbi_write_func *func, void *context, int table_idx, const unsigned char *qtable) {
   unsigned char h[5] = { 0xFF, 0xDB, 0x00, 0x43, (unsigned char)table_idx };
   stbiw__write_context(func, context, h, 5);
   stbiw__write_context(func, context, qtable, 64);
}

static void stbiw__jpg_write_dht(stbi_write_func *func, void *context, int table_type_and_idx, const unsigned char *nrcodes, const unsigned char *values, int val_count) {
   unsigned short len = 3 + 16 + val_count;
   unsigned char h[4] = { 0xFF, 0xC4, (unsigned char)(len >> 8), (unsigned char)(len & 0xFF) };
   stbiw__write_context(func, context, h, 4);
   unsigned char t = (unsigned char)table_type_and_idx;
   stbiw__write_context(func, context, &t, 1);
   stbiw__write_context(func, context, nrcodes + 1, 16);
   stbiw__write_context(func, context, values, val_count);
}

// 1D DCT on 8 points
static void stbiw__jpg_dct_1d(float *out, const float *in) {
   static const float s0 = 0.707106781f;
   static const float s1 = 0.923879532f, c1 = 0.382683432f;
   static const float s2 = 0.707106781f, c2 = 0.707106781f;
   static const float s3 = 0.382683432f, c3 = 0.923879532f;

   float a0 = in[0] + in[7], a7 = in[0] - in[7];
   float a1 = in[1] + in[6], a6 = in[1] - in[6];
   float a2 = in[2] + in[5], a5 = in[2] - in[5];
   float a3 = in[3] + in[4], a4 = in[3] - in[4];

   float b0 = a0 + a3, b3 = a0 - a3;
   float b1 = a1 + a2, b2 = a1 - a2;

   out[0] = (b0 + b1) * 0.5f * s0;
   out[4] = (b0 - b1) * 0.5f * s0;
   out[2] = (b3 * s2 + b2 * c2) * 0.5f;
   out[6] = (b3 * c2 - b2 * s2) * 0.5f;

   float c4 = a4, c5 = (a5 - a6) * s0, c6 = (a5 + a6) * s0, c7 = a7;
   float d4 = c4 + c5, d5 = c4 - c5, d6 = c7 - c6, d7 = c7 + c6;

   out[1] = (d7 * s1 + d4 * c1) * 0.5f;
   out[5] = (d6 * s3 + d5 * c3) * 0.5f;
   out[3] = (d6 * c3 - d5 * s3) * 0.5f;
   out[7] = (d7 * c1 - d4 * s1) * 0.5f;
}

static void stbiw__jpg_dct_2d(short *out_quant, const float *block, const unsigned char *qtable) {
   float temp[64];
   float dct[64];
   for (int i = 0; i < 8; ++i) {
      stbiw__jpg_dct_1d(&temp[i * 8], &block[i * 8]);
   }
   for (int i = 0; i < 8; ++i) {
      float col_in[8], col_out[8];
      for (int j = 0; j < 8; ++j) col_in[j] = temp[j * 8 + i];
      stbiw__jpg_dct_1d(col_out, col_in);
      for (int j = 0; j < 8; ++j) dct[j * 8 + i] = col_out[j];
   }
   for (int i = 0; i < 64; ++i) {
      int zz = stbiw__jpg_ZigZag[i];
      float q = (float)qtable[zz];
      float val = dct[zz] / (q * 8.0f);
      out_quant[i] = (short)(val >= 0.0f ? (val + 0.5f) : (val - 0.5f));
   }
}

static void stbiw__jpg_encode_block(stbiw__jpg_bitstream *bs, const short *block, short *prev_dc,
                                    const stbiw__jpg_huffman_table *dc_ht, const stbiw__jpg_huffman_table *ac_ht) {
   short diff = block[0] - *prev_dc;
   *prev_dc = block[0];

   // Encode DC diff
   if (diff == 0) {
      stbiw__jpg_writeBits(bs, dc_ht->code[0], dc_ht->size[0]);
   } else {
      unsigned short abs_diff = (unsigned short)(diff < 0 ? -diff : diff);
      int bits = 0;
      while (abs_diff > 0) { bits++; abs_diff >>= 1; }
      stbiw__jpg_writeBits(bs, dc_ht->code[bits], dc_ht->size[bits]);
      unsigned short mask = (unsigned short)(diff < 0 ? (diff - 1) : diff);
      stbiw__jpg_writeBits(bs, (unsigned short)(mask & ((1 << bits) - 1)), bits);
   }

   // Encode AC
   int zero_run = 0;
   for (int i = 1; i < 64; ++i) {
      short ac = block[i];
      if (ac == 0) {
         zero_run++;
      } else {
         while (zero_run >= 16) {
            stbiw__jpg_writeBits(bs, ac_ht->code[0xF0], ac_ht->size[0xF0]); // ZRL
            zero_run -= 16;
         }
         unsigned short abs_ac = (unsigned short)(ac < 0 ? -ac : ac);
         int bits = 0;
         while (abs_ac > 0) { bits++; abs_ac >>= 1; }
         int symbol = (zero_run << 4) | bits;
         stbiw__jpg_writeBits(bs, ac_ht->code[symbol], ac_ht->size[symbol]);
         unsigned short mask = (unsigned short)(ac < 0 ? (ac - 1) : ac);
         stbiw__jpg_writeBits(bs, (unsigned short)(mask & ((1 << bits) - 1)), bits);
         zero_run = 0;
      }
   }
   if (zero_run > 0) {
      stbiw__jpg_writeBits(bs, ac_ht->code[0x00], ac_ht->size[0x00]); // EOB
   }
}

int stbi_write_jpg_to_func(stbi_write_func *func, void *context, int x, int y, int comp, const void *data, int quality) {
   if (!func || !data || x <= 0 || y <= 0 || comp < 1) return 0;
   if (quality < 1) quality = 1;
   if (quality > 100) quality = 100;

   // Compute scaled quant tables based on quality
   int scale = quality < 50 ? (5000 / quality) : (200 - quality * 2);
   unsigned char q_lum[64], q_chrom[64];
   for (int i = 0; i < 64; ++i) {
      int l = (stbiw__jpg_LuminanceQuantTable[i] * scale + 50) / 100;
      int c = (stbiw__jpg_ChrominanceQuantTable[i] * scale + 50) / 100;
      q_lum[i] = (unsigned char)(l < 1 ? 1 : (l > 255 ? 255 : l));
      q_chrom[i] = (unsigned char)(c < 1 ? 1 : (c > 255 ? 255 : c));
   }

   // Build huffman tables
   stbiw__jpg_huffman_table dc_lum_ht, ac_lum_ht, dc_chrom_ht, ac_chrom_ht;
   memset(&dc_lum_ht, 0, sizeof(dc_lum_ht));
   memset(&ac_lum_ht, 0, sizeof(ac_lum_ht));
   memset(&dc_chrom_ht, 0, sizeof(dc_chrom_ht));
   memset(&ac_chrom_ht, 0, sizeof(ac_chrom_ht));

   stbiw__jpg_build_huffman(stbiw__jpg_std_dc_luminance_nrcodes, stbiw__jpg_std_dc_luminance_values, &dc_lum_ht);
   stbiw__jpg_build_huffman(stbiw__jpg_std_ac_luminance_nrcodes, stbiw__jpg_std_ac_luminance_values, &ac_lum_ht);
   stbiw__jpg_build_huffman(stbiw__jpg_std_dc_chrominance_nrcodes, stbiw__jpg_std_dc_chrominance_values, &dc_chrom_ht);
   stbiw__jpg_build_huffman(stbiw__jpg_std_ac_chrominance_nrcodes, stbiw__jpg_std_ac_chrominance_values, &ac_chrom_ht);

   // Write Header: SOI
   stbiw__jpg_write_marker(func, context, 0xD8);

   // APP0 (JFIF)
   unsigned char app0[] = { 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0 };
   stbiw__write_context(func, context, app0, sizeof(app0));

   // DQT
   stbiw__jpg_write_dqt(func, context, 0, q_lum);
   stbiw__jpg_write_dqt(func, context, 1, q_chrom);

   // SOF0 (Baseline DCT)
   unsigned char sof0[] = {
      0xFF, 0xC0, 0x00, 0x11, 8,
      (unsigned char)(y >> 8), (unsigned char)(y & 0xFF),
      (unsigned char)(x >> 8), (unsigned char)(x & 0xFF),
      3, // 3 components (Y, Cb, Cr)
      1, 0x11, 0, // Y: ID 1, 1x1 subsample, quant table 0
      2, 0x11, 1, // Cb: ID 2, 1x1 subsample, quant table 1
      3, 0x11, 1  // Cr: ID 3, 1x1 subsample, quant table 1
   };
   stbiw__write_context(func, context, sof0, sizeof(sof0));

   // DHT
   stbiw__jpg_write_dht(func, context, 0x00, stbiw__jpg_std_dc_luminance_nrcodes, stbiw__jpg_std_dc_luminance_values, sizeof(stbiw__jpg_std_dc_luminance_values));
   stbiw__jpg_write_dht(func, context, 0x10, stbiw__jpg_std_ac_luminance_nrcodes, stbiw__jpg_std_ac_luminance_values, sizeof(stbiw__jpg_std_ac_luminance_values));
   stbiw__jpg_write_dht(func, context, 0x01, stbiw__jpg_std_dc_chrominance_nrcodes, stbiw__jpg_std_dc_chrominance_values, sizeof(stbiw__jpg_std_dc_chrominance_values));
   stbiw__jpg_write_dht(func, context, 0x11, stbiw__jpg_std_ac_chrominance_nrcodes, stbiw__jpg_std_ac_chrominance_values, sizeof(stbiw__jpg_std_ac_chrominance_values));

   // SOS
   unsigned char sos[] = {
      0xFF, 0xDA, 0x00, 0x0C, 3,
      1, 0x00,
      2, 0x11,
      3, 0x11,
      0, 63, 0
   };
   stbiw__write_context(func, context, sos, sizeof(sos));

   // Bitstream encode
   stbiw__jpg_bitstream bs = { func, context, 0, 0 };
   short prev_dc_y = 0, prev_dc_cb = 0, prev_dc_cr = 0;

   const unsigned char *pixels = (const unsigned char*)data;
   float block_y[64], block_cb[64], block_cr[64];
   short qblock[64];

   for (int mcu_y = 0; mcu_y < y; mcu_y += 8) {
      for (int mcu_x = 0; mcu_x < x; mcu_x += 8) {
         // Load 8x8 block
         for (int by = 0; by < 8; ++by) {
            int py = (mcu_y + by < y) ? (mcu_y + by) : (y - 1);
            for (int bx = 0; bx < 8; ++bx) {
               int px = (mcu_x + bx < x) ? (mcu_x + bx) : (x - 1);
               int idx = (py * x + px) * comp;
               float r = (float)pixels[idx + 0];
               float g = (float)pixels[idx + 1];
               float b = (float)pixels[idx + 2];

               float Y  =  0.29900f * r + 0.58700f * g + 0.11400f * b - 128.0f;
               float Cb = -0.16874f * r - 0.33126f * g + 0.50000f * b;
               float Cr =  0.50000f * r - 0.41869f * g - 0.08131f * b;

               block_y[by * 8 + bx]  = Y;
               block_cb[by * 8 + bx] = Cb;
               block_cr[by * 8 + bx] = Cr;
            }
         }

         // Y
         stbiw__jpg_dct_2d(qblock, block_y, q_lum);
         stbiw__jpg_encode_block(&bs, qblock, &prev_dc_y, &dc_lum_ht, &ac_lum_ht);

         // Cb
         stbiw__jpg_dct_2d(qblock, block_cb, q_chrom);
         stbiw__jpg_encode_block(&bs, qblock, &prev_dc_cb, &dc_chrom_ht, &ac_chrom_ht);

         // Cr
         stbiw__jpg_dct_2d(qblock, block_cr, q_chrom);
         stbiw__jpg_encode_block(&bs, qblock, &prev_dc_cr, &dc_chrom_ht, &ac_chrom_ht);
      }
   }

   stbiw__jpg_flushBits(&bs);

   // EOI
   stbiw__jpg_write_marker(func, context, 0xD9);
   return 1;
}

#endif // STB_IMAGE_WRITE_IMPLEMENTATION

#ifdef __cplusplus
}
#endif

#endif // INCLUDE_STB_IMAGE_WRITE_H
